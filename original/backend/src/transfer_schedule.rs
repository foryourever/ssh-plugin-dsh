//! 传输性能模型与压缩策略决策（TransferScheduler 的纯计算面）。
//!
//! 分工：本模块不做任何 I/O——带宽观测由传输任务回灌 [`DirectionStats`]，
//! 压缩/解压吞吐由 lzpack 实测回灌；[`decide`] 用这些实测值做纯函数决策。
//! 上传/下载模型严格分离（任务书 §5：有效带宽不能共用一个值）。
//!
//! 决策公式（预测，非承诺）：
//! ```text
//! T_direct     = S / B
//! T_compressed = S / C + r·S / B + S / D + T_overhead
//! ```
//! 压缩方案只有当预计收益 ≥ gain_threshold（缺省 10%，可配）且样本可信
//! （样本量达标）时才入选。当前产品没有远端自研解压器，压缩交付的最终
//! 产物是 `.dbxz` 文件本身——这是显式模式（用户勾选），不是自动透明压缩；
//! 自动决策（`auto`）因此恒选 direct，只有显式 `lzpack` 模式才走压缩公式
//! 校验可行性（压缩后反而更大则拒绝并回落 direct）。
//!
//! 历史容量：每方向最多保留 [`MAX_TRACKED_CONNECTIONS`] 个连接的统计，
//! 超出按最久未更新淘汰（`forget` 语义由 registry 调用方执行）。

/// EMA 平滑系数（α）：每次观测新值权重。0.3 在「快速跟随网络变化」与
/// 「抗单次抖动」之间的常用折中。
pub const EMA_ALPHA: f64 = 0.3;
/// 低于该字节数的观测不回灌模型（小文件 RTT/握手占比高，会污染带宽估计）。
pub const MIN_OBSERVATION_BYTES: u64 = 256 * 1024;
/// 模型可信所需最少观测次数：不足时预测标记为低可信。
pub const MIN_SAMPLES_FOR_CONFIDENCE: u32 = 3;
/// 连接统计容量上限（LRU 淘汰面）。
pub const MAX_TRACKED_CONNECTIONS: usize = 64;
/// 压缩块化开销估计（字节/4MiB 块）：头 + 尾部对齐，实测均值远低于此。
const BLOCK_OVERHEAD_RATIO: f64 = 1.002;
/// 默认收益门槛：压缩预计耗时比直传低 ≥10% 才算划算。
pub const DEFAULT_GAIN_THRESHOLD: f64 = 0.10;

/// 传输方向（模型分离的最小单位）。
#[derive(Clone, Copy, PartialEq, Eq, Debug, Hash)]
pub enum Direction {
    Upload,
    Download,
}

/// 单方向 EMA 带宽观测（字节/秒）。
#[derive(Clone, Copy, Debug, Default)]
pub struct DirectionStats {
    /// EMA 有效带宽（B/s）。None = 尚无足够观测。
    pub ema_bytes_per_sec: Option<f64>,
    /// 已回灌观测次数（达到 MIN_SAMPLES_FOR_CONFIDENCE 视为可信）。
    pub samples: u32,
}

impl DirectionStats {
    /// 回灌一次网络腿观测（elapsed 含纯网络段，不含本地压缩/解压）。
    pub fn observe(&mut self, bytes: u64, elapsed: std::time::Duration) {
        if bytes < MIN_OBSERVATION_BYTES || elapsed.is_zero() {
            return;
        }
        let rate = bytes as f64 / elapsed.as_secs_f64();
        if rate.is_finite() && rate > 0.0 {
            self.ema_bytes_per_sec = Some(match self.ema_bytes_per_sec {
                Some(previous) => previous * (1.0 - EMA_ALPHA) + rate * EMA_ALPHA,
                None => rate,
            });
            self.samples = self.samples.saturating_add(1);
        }
    }

    /// 模型是否可信（样本量达标）。
    pub fn is_confident(&self) -> bool {
        self.samples >= MIN_SAMPLES_FOR_CONFIDENCE
    }
}

/// 每连接性能档案（上传/下载分离 + 压缩吞吐缓存）。
#[derive(Clone, Debug, Default)]
pub struct ConnectionProfile {
    pub upload: DirectionStats,
    pub download: DirectionStats,
    /// 最近一次实测的 lzpack 压缩吞吐（B/s）。None = 未测。
    pub compress_rate: Option<f64>,
    /// 最近一次实测的 lzpack 解压吞吐（B/s）。None = 未测。
    pub decompress_rate: Option<f64>,
    /// 最近一次显式压缩任务的压缩率（compressed/original，0<r≤1）。
    pub last_ratio: Option<f64>,
}

/// LRU 容量约束下的连接档案注册表（键：connection_id，不含凭据）。
#[derive(Default)]
pub struct TransferMetrics {
    profiles: Vec<(String, ConnectionProfile, std::time::Instant)>,
}

impl TransferMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    fn slot(&mut self, connection_id: &str) -> &mut ConnectionProfile {
        let now = std::time::Instant::now();
        if let Some(index) = self
            .profiles
            .iter()
            .position(|(key, _, _)| key == connection_id)
        {
            self.profiles[index].2 = now;
            return &mut self.profiles[index].1;
        }
        if self.profiles.len() >= MAX_TRACKED_CONNECTIONS {
            // 淘汰最久未更新的条目。
            let oldest = self
                .profiles
                .iter()
                .enumerate()
                .min_by_key(|(_, (_, _, at))| *at)
                .map(|(index, _)| index);
            if let Some(index) = oldest {
                self.profiles.remove(index);
            }
        }
        self.profiles
            .push((connection_id.to_string(), ConnectionProfile::default(), now));
        &mut self.profiles.last_mut().expect("just pushed").1
    }

    pub fn observe_network(
        &mut self,
        connection_id: &str,
        direction: Direction,
        bytes: u64,
        elapsed: std::time::Duration,
    ) {
        match direction {
            Direction::Upload => self.slot(connection_id).upload.observe(bytes, elapsed),
            Direction::Download => self.slot(connection_id).download.observe(bytes, elapsed),
        }
    }

    pub fn observe_codec(
        &mut self,
        connection_id: &str,
        compress_bytes_per_sec: f64,
        decompress_bytes_per_sec: f64,
        ratio: f64,
    ) {
        let profile = self.slot(connection_id);
        if compress_bytes_per_sec.is_finite() && compress_bytes_per_sec > 0.0 {
            profile.compress_rate = Some(compress_bytes_per_sec);
        }
        if decompress_bytes_per_sec.is_finite() && decompress_bytes_per_sec > 0.0 {
            profile.decompress_rate = Some(decompress_bytes_per_sec);
        }
        if (0.0..=1.0).contains(&ratio) {
            profile.last_ratio = Some(ratio);
        }
    }

    pub fn profile(&self, connection_id: &str) -> Option<&ConnectionProfile> {
        self.profiles
            .iter()
            .find(|(key, _, _)| key == connection_id)
            .map(|(_, profile, _)| profile)
    }

    pub fn forget(&mut self, connection_id: &str) {
        self.profiles.retain(|(key, _, _)| key != connection_id);
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.profiles.len()
    }
}

/// 压缩方案候选输入（全部实测/实测 EMA，不做理论假设）。
#[derive(Clone, Copy, Debug)]
pub struct CompressionCandidate {
    /// 压缩吞吐（B/s）；未测时 None（决策按不可信处理）。
    pub compress_rate: Option<f64>,
    /// 解压吞吐（B/s）；未测时 None。
    pub decompress_rate: Option<f64>,
    /// 预计压缩率（0<r≤1）；历史 None 时用候选自报值。
    pub expected_ratio: f64,
}

/// 决策结果。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TransferStrategy {
    /// 直接传输原始字节（默认与回退路径）。
    Direct,
    /// 压缩交付（显式 .dbxz 模式）：仅当预测收益达门槛且 codec 吞吐可信。
    Compressed,
}

/// 纯函数决策（任务书 §5）：比较 T_direct 与 T_compressed。
/// `bandwidth` 为该方向 EMA 实测；`gain_threshold` 为用户配置的最低收益
/// （0.10 = 10%）。带宽/吞吐任一未知时保守选 Direct——不拿理论值赌博。
pub fn decide(
    size: u64,
    direction: Direction,
    bandwidth: Option<f64>,
    candidate: CompressionCandidate,
    gain_threshold: f64,
) -> (TransferStrategy, f64) {
    // 压缩交付的硬前提：codec 吞吐有实测值；比率合理；压缩后体积必须
    // 严格小于原始（比率 ≥1 或 ≥0.98 时压缩毫无意义）。
    let (Some(compress_rate), Some(decompress_rate)) =
        (candidate.compress_rate, candidate.decompress_rate)
    else {
        return (TransferStrategy::Direct, 0.0);
    };
    let ratio = candidate.expected_ratio;
    if !(0.0 < ratio && ratio < 0.98) || compress_rate <= 0.0 || decompress_rate <= 0.0 {
        return (TransferStrategy::Direct, 0.0);
    }
    let Some(bandwidth) = bandwidth.filter(|value| *value > 0.0) else {
        return (TransferStrategy::Direct, 0.0);
    };
    let size_f = size as f64;
    // 块化容器固定开销：压缩流按比例放大。
    let compressed_size = size_f * ratio * BLOCK_OVERHEAD_RATIO;
    let t_direct = size_f / bandwidth;
    let t_compressed =
        size_f / compress_rate + compressed_size / bandwidth + size_f / decompress_rate;
    if !t_direct.is_finite() || !t_compressed.is_finite() || t_compressed <= 0.0 {
        return (TransferStrategy::Direct, 0.0);
    }
    let gain = (t_direct - t_compressed) / t_direct;
    if gain >= gain_threshold {
        (TransferStrategy::Compressed, gain)
    } else {
        (TransferStrategy::Direct, gain.max(0.0))
    }
    .pipe(|result| {
        let _ = direction; // 方向只影响带宽来源（调用方传入），决策本体对称
        result
    })
}

/// 方向带宽查询助手（上传/下载分离取数）。
pub fn bandwidth_for(profile: &ConnectionProfile, direction: Direction) -> Option<f64> {
    match direction {
        Direction::Upload => profile.upload.ema_bytes_per_sec,
        Direction::Download => profile.download.ema_bytes_per_sec,
    }
}

/// 显式压缩模式的顾问结论（不改变策略——交付语义由用户决定；仅产出前端
/// 可展示的提示载荷与日志判断依据）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Advice {
    /// 无足够观测（带宽或 codec 吞吐缺一）——沉默，不打扰用户。
    NoData,
    /// 预测压缩交付比直传原始字节还慢（负收益 ≥ 门槛）——建议直传。
    RecommendDirect,
    /// 预测压缩交付有正收益——维持用户选择。
    Endorse,
}

/// 显式压缩模式的顾问决策（P3）：与 [`decide`] 同公式，但结论是建议而非
/// 选择——显式模式下带宽/吞吐任一未知都不能拦截用户，只能沉默。
pub fn advise_explicit_compression(
    size: u64,
    direction: Direction,
    profile: &ConnectionProfile,
    expected_ratio: f64,
    gain_threshold: f64,
) -> Advice {
    // 预测可信度门槛（任务书 §5）：带宽 EMA 样本不足时沉默——少量大文件
    // 观测就敢建议用户改道，比不说话更危险。
    let stats = match direction {
        Direction::Upload => &profile.upload,
        Direction::Download => &profile.download,
    };
    if !stats.is_confident() {
        return Advice::NoData;
    }
    let Some(bandwidth) = bandwidth_for(profile, direction) else {
        return Advice::NoData;
    };
    let candidate = CompressionCandidate {
        compress_rate: profile.compress_rate,
        decompress_rate: profile.decompress_rate,
        expected_ratio,
    };
    let (strategy, _gain) = decide(size, direction, Some(bandwidth), candidate, gain_threshold);
    match strategy {
        TransferStrategy::Compressed => Advice::Endorse,
        // decide() 在数据缺失时也回 Direct；这里区分「真预测直传更快」与
        // 「数据不足」：codec 吞吐任一缺失 → NoData（不臆测）。
        TransferStrategy::Direct
            if profile.compress_rate.is_none() || profile.decompress_rate.is_none() =>
        {
            Advice::NoData
        }
        TransferStrategy::Direct => Advice::RecommendDirect,
    }
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}
impl<T> Pipe for T {}

#[cfg(test)]
mod tests {
    use super::*;

    const MIB: f64 = 1024.0 * 1024.0;

    #[test]
    fn ema_converges_and_requires_min_bytes() {
        let mut stats = DirectionStats::default();
        stats.observe(1024, std::time::Duration::from_secs(1)); // 太小，忽略
        assert!(stats.ema_bytes_per_sec.is_none());
        stats.observe(2 * MIB as u64, std::time::Duration::from_secs(2));
        let first = stats.ema_bytes_per_sec.unwrap();
        assert!((first - MIB).abs() < 1.0);
        assert!(!stats.is_confident());
        stats.observe(4 * MIB as u64, std::time::Duration::from_secs(2));
        stats.observe(4 * MIB as u64, std::time::Duration::from_secs(2));
        assert!(stats.is_confident());
        // EMA 向新值收敛但保留历史权重。
        let latest = stats.ema_bytes_per_sec.unwrap();
        assert!(latest > first && latest < 2.0 * MIB);
    }

    #[test]
    fn metrics_tracks_directions_and_capacity() {
        let mut metrics = TransferMetrics::new();
        metrics.observe_network(
            "conn-a",
            Direction::Upload,
            4 * MIB as u64,
            std::time::Duration::from_secs(4),
        );
        metrics.observe_network(
            "conn-a",
            Direction::Download,
            8 * MIB as u64,
            std::time::Duration::from_secs(4),
        );
        let profile = metrics.profile("conn-a").unwrap();
        assert!((profile.upload.ema_bytes_per_sec.unwrap() - MIB).abs() < 1.0);
        assert!((profile.download.ema_bytes_per_sec.unwrap() - 2.0 * MIB).abs() < 1.0);
        metrics.forget("conn-a");
        assert!(metrics.profile("conn-a").is_none());
        // 容量上限：塞入超限连接后总数不涨，最旧的被淘汰。
        for index in 0..(MAX_TRACKED_CONNECTIONS + 8) {
            metrics.observe_network(
                &format!("conn-{index}"),
                Direction::Upload,
                4 * MIB as u64,
                std::time::Duration::from_secs(4),
            );
        }
        assert_eq!(metrics.len(), MAX_TRACKED_CONNECTIONS);
        assert!(metrics.profile("conn-0").is_none());
    }

    #[test]
    fn decide_prefers_direct_without_codec_measurements() {
        let candidate = CompressionCandidate {
            compress_rate: None,
            decompress_rate: None,
            expected_ratio: 0.4,
        };
        let (strategy, _) = decide(
            100 * MIB as u64,
            Direction::Upload,
            Some(MIB),
            candidate,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(strategy, TransferStrategy::Direct);
    }

    #[test]
    fn decide_compressed_when_gain_exceeds_threshold() {
        // 100 MiB @ 1 MiB/s 直传 = 100s；压缩 50 MiB/s + 比率 0.4 + 解压
        // 200 MiB/s ≈ 2 + 40 + 0.5 = 42.5s → 收益 57%。
        let candidate = CompressionCandidate {
            compress_rate: Some(50.0 * MIB),
            decompress_rate: Some(200.0 * MIB),
            expected_ratio: 0.4,
        };
        let (strategy, gain) = decide(
            100 * MIB as u64,
            Direction::Download,
            Some(MIB),
            candidate,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(strategy, TransferStrategy::Compressed);
        assert!(gain > 0.5, "gain {gain}");
    }

    #[test]
    fn decide_direct_when_bandwidth_high_and_codec_slow() {
        // 1 Gbps 链路 + 慢压缩：压缩耗时反超直传。
        let candidate = CompressionCandidate {
            compress_rate: Some(30.0 * MIB),
            decompress_rate: Some(100.0 * MIB),
            expected_ratio: 0.9,
        };
        let (strategy, _) = decide(
            100 * MIB as u64,
            Direction::Upload,
            Some(1000.0 * MIB),
            candidate,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(strategy, TransferStrategy::Direct);
    }

    #[test]
    fn decide_rejects_incompressible_ratio() {
        let candidate = CompressionCandidate {
            compress_rate: Some(50.0 * MIB),
            decompress_rate: Some(200.0 * MIB),
            expected_ratio: 0.99,
        };
        let (strategy, _) = decide(
            100 * MIB as u64,
            Direction::Upload,
            Some(MIB),
            candidate,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(strategy, TransferStrategy::Direct);
    }

    #[test]
    fn decide_respects_configured_threshold() {
        // 收益 ~33%（30s vs 20s），门槛 50% 拒绝、10% 接受。
        let candidate = CompressionCandidate {
            compress_rate: Some(100.0 * MIB),
            decompress_rate: Some(300.0 * MIB),
            expected_ratio: 0.5,
        };
        let size = 30 * MIB as u64;
        let (rejected, gain) = decide(size, Direction::Upload, Some(MIB), candidate, 0.50);
        assert_eq!(rejected, TransferStrategy::Direct);
        let (accepted, _) = decide(size, Direction::Upload, Some(MIB), candidate, 0.10);
        assert_eq!(accepted, TransferStrategy::Compressed);
        assert!(gain > 0.4 && gain < 0.5, "gain {gain}");
    }

    #[test]
    fn advise_endorses_when_gain_positive() {
        let mut profile = ConnectionProfile {
            upload: DirectionStats {
                ema_bytes_per_sec: Some(MIB),
                samples: 3,
            },
            ..ConnectionProfile::default()
        };
        profile.compress_rate = Some(50.0 * MIB);
        profile.decompress_rate = Some(200.0 * MIB);
        let advice = advise_explicit_compression(
            100 * MIB as u64,
            Direction::Upload,
            &profile,
            0.4,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(advice, Advice::Endorse);
    }

    #[test]
    fn advise_recommends_direct_on_slow_codec() {
        let mut profile = ConnectionProfile {
            upload: DirectionStats {
                ema_bytes_per_sec: Some(1000.0 * MIB),
                samples: 3,
            },
            ..ConnectionProfile::default()
        };
        profile.compress_rate = Some(30.0 * MIB);
        profile.decompress_rate = Some(100.0 * MIB);
        let advice = advise_explicit_compression(
            100 * MIB as u64,
            Direction::Upload,
            &profile,
            0.9,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(advice, Advice::RecommendDirect);
    }

    #[test]
    fn advise_silent_without_codec_measurements() {
        let profile = ConnectionProfile {
            upload: DirectionStats {
                ema_bytes_per_sec: Some(MIB),
                samples: 3,
            },
            ..ConnectionProfile::default()
        };
        let advice = advise_explicit_compression(
            100 * MIB as u64,
            Direction::Upload,
            &profile,
            0.4,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(advice, Advice::NoData);
    }

    #[test]
    fn decide_without_bandwidth_is_direct() {
        let candidate = CompressionCandidate {
            compress_rate: Some(50.0 * MIB),
            decompress_rate: Some(200.0 * MIB),
            expected_ratio: 0.4,
        };
        let (strategy, _) = decide(
            100 * MIB as u64,
            Direction::Download,
            None,
            candidate,
            DEFAULT_GAIN_THRESHOLD,
        );
        assert_eq!(strategy, TransferStrategy::Direct);
    }
}
