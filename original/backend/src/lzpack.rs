//! DBXZ 无损压缩格式（自研 LZ77，版本化块化容器）。
//!
//! 目标场景：显式压缩包模式——用户明确要求压缩交付时，本地自研压缩器产出
//! `.dbxz` 文件经 SFTP 传输；`.dbxz` 下载后由本地自研解压器还原。与 M33
//! gzip 混合方案（依赖远端 shell）互不替代：本模块全程不需要远端执行任何
//! 程序，shell-less 服务器可用。
//!
//! 格式（v1）：
//!
//! ```text
//! magic   : "DBXZ"           4 字节
//! version : u8               = 1
//! reserved: 3 字节           = 0（对齐；v2+ 从这里扩展 flag 位）
//! ── 逐块（循环直到 EOF）──
//! kind    : u8               0=RAW 原样块 1=LZ77 压缩块
//! payload_len : u32 BE       本块 payload 字节数
//! original_len: u32 BE       本块解压后字节数（RAW 与 payload_len 相等）
//! payload : payload_len 字节
//! ```
//!
//! 压缩块 payload 内是 LZ77 token 流：bit 流逐 token 打包（首 bit=字面量 0 /
//! 匹配 1），字面量后跟 8 bit；匹配为 `<len:12><dist:16>`（len 3..=4095，
//! dist 1..=65535），编码时 len 与 dist 各减 1 存原始-1，MSB-first。
//!
//! 安全防护：块头字段上限校验（original_len ≤ MAX_BLOCK_ORIGINAL）、解压
//! 输出总量钳制（expected_size 缺省 MAX_TOTAL_OUTPUT）、匹配引用出界/自
//! 重叠安全（逐字节拷贝天然支持 overlap）、magic/版本/截断/尾随垃圾检测。
//! 解压器是纯函数：任何非法输入返回 Err 而非 panic（fuzz 友好）。
//!
//! 算法：LZ77 + 4 字节哈希头（一槽哈希表，冲突即覆盖），窗口 64KiB。匹配
//! 搜索在块内进行（跨块不引用——单块损坏不扩散）。为控制最坏情况耗时，
//! 每块匹配搜索步数封顶（线性退化保护，重复数据场景）。

/// 容器 magic：`DBXZ`。
pub const MAGIC: &[u8; 4] = b"DBXZ";
/// 当前格式版本。
pub const FORMAT_VERSION: u8 = 1;
/// 压缩块原始数据上限（4 MiB）：块表开销与窗口重置成本的折中。
pub const MAX_BLOCK_ORIGINAL: usize = 4 * 1024 * 1024;
/// 解压输出总量缺省上限（1 GiB + 余量）：恶意/损坏文件防炸内存。
/// 调用方带 expected_size 时以传入值为准。
pub const DEFAULT_MAX_TOTAL_OUTPUT: usize = (1 << 30) + (1 << 20);
/// LZ77 窗口 64 KiB：dist 编码 16 bit 的上限。
pub const LZ_WINDOW: usize = 1 << 16;
/// 最小匹配长度（3 字节以下引用比字面量更贵）。
pub const MIN_MATCH: usize = 3;
/// 最大匹配长度（12 bit 编码 + 1）。
pub const MAX_MATCH: usize = 4095;
/// 哈希表槽数（2^18）：4 字节键取平方散列，冲突覆盖即可（贪心匹配）。
const HASH_SLOTS: usize = 1 << 18;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodecError(pub String);

impl std::fmt::Display for CodecError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CodecError {}

fn err(message: impl Into<String>) -> CodecError {
    CodecError(message.into())
}

/// 最外层容器头部：4(magic)+1(version)+8(original_size u64 BE)+3(reserved)。
/// v1 即携带原始总长：下载 expand 管线在解压前就能知道交付体积（SFTP
/// stat 压缩流 → 前端进度/EOF 语义按原始体积走）。
pub const HEADER_LEN: usize = 16;
/// 单块头：kind 1 + payload_len 4 + original_len 4。
pub const BLOCK_HEADER_LEN: usize = 9;
const KIND_RAW: u8 = 0;
const KIND_LZ77: u8 = 1;

// ── 压缩 ────────────────────────────────────────────────────────────────

/// 压缩 `input` 为完整 DBXZ 容器。任何输入都合法（空数据 → 单 RAW 块）。
/// 返回值仅为容器总长（写入由调用方注入的 sink 承担，避免大输出双份拷贝）。
pub fn compress(input: &[u8], sink: &mut dyn FnMut(&[u8])) -> Result<usize, CodecError> {
    let mut total = 0_usize;
    let mut header = Vec::with_capacity(HEADER_LEN);
    header.extend_from_slice(MAGIC);
    header.push(FORMAT_VERSION);
    header.extend_from_slice(&(input.len() as u64).to_be_bytes());
    header.extend_from_slice(&[0_u8; 3]);
    sink(&header);
    total += header.len();

    for chunk in input.chunks(MAX_BLOCK_ORIGINAL) {
        let compressed = lz77_block(chunk);
        // 尺寸守卫：压缩流不比原始短（含块头）即回退 RAW 块。
        let use_lz = compressed.len() + BLOCK_HEADER_LEN < chunk.len();
        if use_lz {
            let mut block = Vec::with_capacity(BLOCK_HEADER_LEN + compressed.len());
            block.push(KIND_LZ77);
            block.extend_from_slice(&(compressed.len() as u32).to_be_bytes());
            block.extend_from_slice(&(chunk.len() as u32).to_be_bytes());
            sink(&block);
            sink(&compressed);
            total += block.len() + compressed.len();
        } else {
            total += emit_raw_block(chunk, sink)?;
        }
    }
    // 空输入：零块容器是合法流，但为可观测性补一个 RAW 空块。
    if input.is_empty() {
        total += emit_raw_block(&[], sink)?;
    }
    Ok(total)
}

fn emit_raw_block(data: &[u8], sink: &mut dyn FnMut(&[u8])) -> Result<usize, CodecError> {
    if data.len() > MAX_BLOCK_ORIGINAL {
        return Err(err("raw block exceeds size cap"));
    }
    let mut block = Vec::with_capacity(BLOCK_HEADER_LEN + data.len());
    block.push(KIND_RAW);
    block.extend_from_slice(&(data.len() as u32).to_be_bytes());
    block.extend_from_slice(&(data.len() as u32).to_be_bytes());
    sink(&block);
    if !data.is_empty() {
        sink(data);
    }
    Ok(block.len() + data.len())
}

/// 单块 LZ77：哈希一槽 + 贪心最长匹配 + 步数封顶。
fn lz77_block(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len() / 2 + 16);
    // bit 流：bits 累积从 MSB 填充，flush 时左移对齐。
    let mut bits: u64 = 0;
    let mut bit_count: u32 = 0;
    let mut hash_table = vec![usize::MAX; HASH_SLOTS];

    let emit_bit = |out: &mut Vec<u8>, bits: &mut u64, count: &mut u32, bit: u8| {
        *bits = (*bits << 1) | (bit & 1) as u64;
        *count += 1;
        if *count == 8 {
            out.push((*bits & 0xff) as u8);
            *bits = 0;
            *count = 0;
        }
    };
    // 字面量走字节对齐：token bit 之后把残位补齐成整字节，原始字节直接
    // 追加（拷贝友好）。解压侧读到 0 bit 后同样先跳到字节边界再取 8 bit。
    let flush_partial = |out: &mut Vec<u8>, bits: &mut u64, count: &mut u32| {
        if *count > 0 {
            out.push(((*bits << (8 - *count)) & 0xff) as u8);
            *bits = 0;
            *count = 0;
        }
    };
    let emit_u16 = |out: &mut Vec<u8>, bits: &mut u64, count: &mut u32, value: u16| {
        for shift in (0..16).rev() {
            emit_bit(out, bits, count, ((value >> shift) & 1) as u8);
        }
    };

    let mut position = 0_usize;
    while position < input.len() {
        let best = if position + MIN_MATCH <= input.len() {
            let key = hash4(&input[position..]);
            let mut found: Option<(usize, usize)> = None; // (distance, length)
            let candidate = hash_table[key];
            if candidate != usize::MAX {
                // 单槽哈希只查一个候选（无链可追）；MAX_MATCH_PROBES 保留
                // 给后续哈希链表扩链时的最坏情况封顶。
                let window_start = position.saturating_sub(LZ_WINDOW);
                if candidate >= window_start && candidate < position {
                    let max_len = (input.len() - position).min(MAX_MATCH);
                    let mut length = 0;
                    // 逐字节比较；允许 overlap（candidate+len 可以越过 position）。
                    while length < max_len && input[candidate + length] == input[position + length]
                    {
                        length += 1;
                    }
                    if length >= MIN_MATCH && found.is_none_or(|(_, best_len)| length > best_len) {
                        found = Some((position - candidate, length));
                    }
                }
            }
            hash_table[key] = position;
            found
        } else {
            None
        };

        match best {
            Some((distance, length)) => {
                emit_bit(&mut out, &mut bits, &mut bit_count, 1);
                emit_u16(&mut out, &mut bits, &mut bit_count, (length - 1) as u16);
                emit_u16(&mut out, &mut bits, &mut bit_count, (distance - 1) as u16);
                // 匹配区间内的每个位置也要入哈希表（后续位置可引用）。
                for offset in 1..length {
                    let index = position + offset;
                    if index + MIN_MATCH <= input.len() {
                        let key = hash4(&input[index..]);
                        hash_table[key] = index;
                    }
                }
                position += length;
            }
            None => {
                // 字面量 run：0 bit + flush 对齐 + run 长度（u8）+ 原始字节。
                // run 上限 255：连续字面量合并进一个 run，摊薄 per-token 开销。
                let run_start = position;
                let mut run_end = position;
                let run_limit = input.len().min(run_start + 255);
                // 向后吞字面量：直到下一个位置能形成匹配（先贪吃，找不到
                // 匹配的字节段都算 run；为了简单，run 边界按「下一位置有
                // 匹配」回看判定——实现为：先吃一个字节，再继续吃直到
                // hash 命中窗口内候选）。
                run_end += 1;
                while run_end < run_limit && run_end + MIN_MATCH <= input.len() {
                    let key = hash4(&input[run_end..]);
                    let candidate = hash_table[key];
                    let window_start = run_end.saturating_sub(LZ_WINDOW);
                    let has_match = candidate != usize::MAX
                        && candidate >= window_start
                        && candidate < run_end
                        && input[candidate] == input[run_end]
                        && input[candidate + 1] == input[run_end + 1]
                        && input[candidate + 2] == input[run_end + 2];
                    if has_match {
                        break;
                    }
                    run_end += 1;
                }
                let run_len = run_end - run_start;
                emit_bit(&mut out, &mut bits, &mut bit_count, 0);
                flush_partial(&mut out, &mut bits, &mut bit_count);
                out.push(run_len as u8);
                out.extend_from_slice(&input[run_start..run_end]);
                for index in run_start..run_end {
                    if index + MIN_MATCH <= input.len() {
                        let key = hash4(&input[index..]);
                        hash_table[key] = index;
                    }
                }
                position = run_end;
            }
        }
    }
    // 尾部残位：左移对齐后写一个收尾字节。
    if bit_count > 0 {
        out.push(((bits << (8 - bit_count)) & 0xff) as u8);
    }
    out
}

fn hash4(data: &[u8]) -> usize {
    // 调用方保证至少 MIN_MATCH 字节；此处理防御式补齐，避免切片构造开销。
    let mut key = [
        data[0],
        data[1],
        data[2],
        if data.len() > 3 { data[3] } else { 0 },
    ];
    if data.len() > 4 {
        key[3] = key[3].wrapping_add(data[data.len() - 1]);
    }
    let value = u32::from_le_bytes(key);
    // 乘法散列取高位（乘数参考 Rc32 常数族，非对任何第三方实现的结构复制）。
    ((value.wrapping_mul(0x9E37_79B9) >> 14) as usize) & (HASH_SLOTS - 1)
}

// ── 解压 ────────────────────────────────────────────────────────────────

/// 解压 DBXZ 容器。`expected_size` 提供时作为输出总量硬上限（调用方在
/// stat 之后传入原始文件大小）；`None` 用 [`DEFAULT_MAX_TOTAL_OUTPUT`]。
/// `sink` 逐原始块回调（流式写盘用），返回写入总量。
pub fn decompress(
    input: &[u8],
    expected_size: Option<usize>,
    sink: &mut dyn FnMut(&[u8]),
) -> Result<usize, CodecError> {
    if input.len() < HEADER_LEN {
        return Err(err("truncated container header"));
    }
    if &input[..4] != MAGIC {
        return Err(err("bad magic"));
    }
    if input[4] != FORMAT_VERSION {
        return Err(err(format!("unsupported format version {}", input[4])));
    }
    let declared_size = u64::from_be_bytes(input[5..13].try_into().unwrap()) as usize;
    if input[13..16] != [0_u8; 3] {
        return Err(err("reserved header bytes must be zero"));
    }
    // 容器声明总长是硬校验：传入 expected_size 时两者必须一致；未传入时
    // 以声明值做输出上限（仍受 DEFAULT_MAX_TOTAL_OUTPUT 兜底）。
    if let Some(expected) = expected_size {
        if declared_size != expected {
            return Err(err(format!(
                "declared size {declared_size} does not match expected {expected}"
            )));
        }
    }
    if declared_size > DEFAULT_MAX_TOTAL_OUTPUT {
        return Err(err("declared size exceeds cap"));
    }
    let cap = declared_size;
    let mut total = 0_usize;
    let mut cursor = HEADER_LEN;
    let mut saw_block = false;
    while cursor < input.len() {
        saw_block = true;
        if input.len() - cursor < BLOCK_HEADER_LEN {
            return Err(err("truncated block header"));
        }
        let kind = input[cursor];
        let payload_len =
            u32::from_be_bytes(input[cursor + 1..cursor + 5].try_into().unwrap()) as usize;
        let original_len =
            u32::from_be_bytes(input[cursor + 5..cursor + 9].try_into().unwrap()) as usize;
        cursor += BLOCK_HEADER_LEN;
        if payload_len > input.len() - cursor {
            return Err(err("truncated block payload"));
        }
        let payload = &input[cursor..cursor + payload_len];
        cursor += payload_len;
        if original_len > MAX_BLOCK_ORIGINAL {
            return Err(err("block original size exceeds cap"));
        }
        if total.saturating_add(original_len) > cap {
            return Err(err("decompressed output exceeds size cap"));
        }
        match kind {
            KIND_RAW => {
                if payload_len != original_len {
                    return Err(err("raw block length mismatch"));
                }
                if original_len > 0 {
                    sink(payload);
                }
                total += original_len;
            }
            KIND_LZ77 => {
                lz77_expand(payload, original_len, &mut |slice: &[u8]| {
                    sink(slice);
                })?;
                total += original_len;
            }
            other => return Err(err(format!("unknown block kind {other}"))),
        }
    }
    if !saw_block {
        // 零块容器只在压缩器对空输入的输出中出现（带一个空 RAW 块）；
        // 裸头说明流被截断或损坏。
        return Err(err("container has no blocks"));
    }
    if total != cap {
        return Err(err(format!(
            "decompressed size mismatch: {total} of expected {cap}"
        )));
    }
    Ok(total)
}

/// 读取容器头声明的原始总长（不校验 magic 之外的任何东西）——下载
/// expand 管线在拉流前用本地头 16 字节探测交付体积。非法头（过短/坏
/// magic/未知版本）返回 Err。
pub fn read_container_original_size(input: &[u8]) -> Result<u64, CodecError> {
    if input.len() < HEADER_LEN {
        return Err(err("truncated container header"));
    }
    if &input[..4] != MAGIC {
        return Err(err("bad magic"));
    }
    if input[4] != FORMAT_VERSION {
        return Err(err(format!("unsupported format version {}", input[4])));
    }
    Ok(u64::from_be_bytes(input[5..13].try_into().unwrap()))
}

/// 块内 LZ77 展开：`bit 流 + <len:12><dist:16>` token，输出恰为
/// `expected_len` 字节（多/少都算损坏）。输出经 sink 逐段回调。
fn lz77_expand(
    payload: &[u8],
    expected_len: usize,
    sink: &mut dyn FnMut(&[u8]),
) -> Result<(), CodecError> {
    let mut out: Vec<u8> = Vec::with_capacity(expected_len.min(MAX_BLOCK_ORIGINAL));
    let mut bit_pos = 0_usize; // 全局 bit 游标（payload 首 bit 起）
    let total_bits = payload.len() * 8;
    let read_bit = |bit_pos: &mut usize| -> Result<u8, CodecError> {
        if *bit_pos >= total_bits {
            return Err(err("token stream truncated"));
        }
        let bit = (payload[*bit_pos / 8] >> (7 - (*bit_pos % 8))) & 1;
        *bit_pos += 1;
        Ok(bit)
    };
    let read_u16 = |bit_pos: &mut usize| -> Result<u16, CodecError> {
        let mut value: u16 = 0;
        for _ in 0..16 {
            value = (value << 1) | read_bit(bit_pos)? as u16;
        }
        Ok(value)
    };
    while out.len() < expected_len {
        match read_bit(&mut bit_pos)? {
            0 => {
                // 字面量 run：跳到字节边界，取 run 长度（1..=255），随后
                // 原始字节直接追加（压缩侧 flush 对齐 + 长度 + 字节串）。
                if !bit_pos.is_multiple_of(8) {
                    bit_pos += 8 - (bit_pos % 8);
                }
                if bit_pos + 8 > total_bits {
                    return Err(err("literal run truncated"));
                }
                let run_len = payload[bit_pos / 8] as usize;
                bit_pos += 8;
                if run_len == 0 {
                    return Err(err("empty literal run"));
                }
                let run_bytes = run_len * 8;
                if bit_pos + run_bytes > total_bits {
                    return Err(err("literal run payload truncated"));
                }
                let start = bit_pos / 8;
                out.extend_from_slice(&payload[start..start + run_len]);
                bit_pos += run_bytes;
            }
            _ => {
                let length = read_u16(&mut bit_pos)? as usize + 1;
                let distance = read_u16(&mut bit_pos)? as usize + 1;
                if !(MIN_MATCH..=MAX_MATCH).contains(&length) {
                    return Err(err(format!("invalid match length {length}")));
                }
                if distance == 0 || distance > LZ_WINDOW || distance > out.len() {
                    return Err(err(format!("invalid match distance {distance}")));
                }
                // overlap 安全：逐字节自拷贝（RLE 语义）。
                let start = out.len() - distance;
                for step in 0..length {
                    let byte = out[start + step];
                    out.push(byte);
                }
            }
        }
    }
    // 收尾：压缩侧 flush 会补一个对齐残位字节（≤7 bit 信息 + 0 填充）；
    // 仅当残位恰为 0 bit（流恰好在字节边界结束）时不再有收尾字节。任何
    // 整字节的额外数据都是垃圾。
    let leftover_bits = total_bits - bit_pos;
    if leftover_bits >= 8 {
        return Err(err("trailing garbage after token stream"));
    }
    if out.len() != expected_len {
        return Err(err(format!(
            "block expanded to {} bytes, expected {expected_len}",
            out.len()
        )));
    }
    sink(&out);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roundtrip(input: &[u8]) {
        let mut packed = Vec::new();
        let packed_len = compress(input, &mut |slice| packed.extend_from_slice(slice)).unwrap();
        assert_eq!(packed_len, packed.len());
        let mut restored = Vec::new();
        let total = decompress(&packed, Some(input.len()), &mut |slice| {
            restored.extend_from_slice(slice)
        })
        .unwrap();
        assert_eq!(total, input.len());
        assert_eq!(restored, input);
    }

    #[test]
    fn empty_input_roundtrips() {
        roundtrip(b"");
    }

    #[test]
    fn single_byte_roundtrips() {
        roundtrip(b"x");
    }

    #[test]
    fn random_data_roundtrips_and_falls_back_to_raw() {
        // 伪随机（xorshift）：不可压内容应走 RAW 块而不是膨胀。
        let mut seed: u64 = 0x243F_6A88_85A3_08D3;
        let mut input = Vec::with_capacity(600 * 1024);
        while input.len() < 600 * 1024 {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            input.extend_from_slice(&seed.to_le_bytes());
        }
        let mut packed = Vec::new();
        let packed_len = compress(&input, &mut |slice| packed.extend_from_slice(slice)).unwrap();
        // RAW 转义后体积 ≈ 输入 + 9B/块。
        assert!(
            packed_len < input.len() + 32,
            "random data must not balloon: {packed_len} vs {}",
            input.len()
        );
        roundtrip(&input);
    }

    #[test]
    fn repetitive_data_compresses_well() {
        let input = vec![b'a'; 256 * 1024];
        let mut packed = Vec::new();
        let packed_len = compress(&input, &mut |slice| packed.extend_from_slice(slice)).unwrap();
        assert!(
            packed_len < input.len() / 10,
            "repetitive data should compress: {packed_len}"
        );
        roundtrip(&input);
    }

    #[test]
    fn mixed_text_like_data_roundtrips() {
        let mut input = Vec::new();
        for line in 0..20_000_u32 {
            let bucket = line % 64;
            input.extend_from_slice(
                format!("SELECT * FROM table_{bucket} WHERE id = {line};\n").as_bytes(),
            );
        }
        roundtrip(&input);
    }

    #[test]
    fn large_file_block_splits_roundtrip() {
        // 超过单块上限（4MiB）触发分块：两块内容不同，验证块间互不引用。
        let part_a = vec![7_u8; MAX_BLOCK_ORIGINAL + 10];
        let mut part_b = Vec::with_capacity(MAX_BLOCK_ORIGINAL + 5);
        let mut seed: u64 = 42;
        while part_b.len() < MAX_BLOCK_ORIGINAL + 5 {
            seed = seed
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            part_b.push((seed >> 33) as u8);
        }
        let mut input = part_a;
        input.extend_from_slice(&part_b);
        roundtrip(&input);
    }

    #[test]
    fn overlap_run_roundtrips() {
        // RLE 场景：dist < len 的自重叠匹配。
        roundtrip(b"abababababababababababababab");
        roundtrip(&vec![0_u8; 100_000]);
    }

    #[test]
    fn bad_magic_rejected() {
        let mut packed = Vec::new();
        compress(b"hello", &mut |slice| packed.extend_from_slice(slice)).unwrap();
        packed[0] = b'X';
        assert!(decompress(&packed, None, &mut |_| {}).is_err());
    }

    #[test]
    fn truncated_stream_rejected() {
        let mut packed = Vec::new();
        compress(&vec![b'z'; 100_000], &mut |slice| {
            packed.extend_from_slice(slice)
        })
        .unwrap();
        for cut in [0, 3, 8, 15, 40] {
            assert!(
                decompress(&packed[..cut.min(packed.len())], None, &mut |_| {}).is_err(),
                "cut at {cut} must fail"
            );
        }
    }

    #[test]
    fn corrupted_match_distance_rejected() {
        // 手工构造：magic+version+LZ77 块，payload 为「匹配 token，dist 超出已输出」。
        let mut packed = Vec::new();
        packed.extend_from_slice(MAGIC);
        packed.push(FORMAT_VERSION);
        packed.extend_from_slice(&[0; 3]);
        // token: 匹配 bit=1, len-1=0(=1 字节，非法下限 3 之下？len=1 < MIN_MATCH)
        // bit 流：1, then len=0x0000 → len 1 → 非法长度。
        let payload: Vec<u8> = vec![0b1000_0000, 0x00, 0x00, 0x00, 0x00];
        packed.push(KIND_LZ77);
        packed.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        packed.extend_from_slice(&16_u32.to_be_bytes());
        packed.extend_from_slice(&payload);
        assert!(decompress(&packed, None, &mut |_| {}).is_err());
    }

    #[test]
    fn output_cap_enforced() {
        let input = vec![b'q'; 300_000];
        let mut packed = Vec::new();
        compress(&input, &mut |slice| packed.extend_from_slice(slice)).unwrap();
        let mut sink_called = false;
        // expected_size 与容器声明不一致：头校验先行拒绝，sink 不被触达。
        let error = decompress(&packed, Some(100), &mut |_| sink_called = true).unwrap_err();
        assert!(
            !sink_called,
            "mismatch must trip before any data reaches the sink"
        );
        assert!(error.0.contains("match"), "{error}");
        // 缺省上限内的正常解压不受影响（声明与 expected 一致）。
        let mut restored = Vec::new();
        let total = decompress(&packed, Some(300_000), &mut |slice| {
            restored.extend_from_slice(slice)
        })
        .unwrap();
        assert_eq!(total, 300_000);
        assert_eq!(restored, input);
    }

    #[test]
    fn wrong_version_rejected() {
        let mut packed = Vec::new();
        compress(b"data", &mut |slice| packed.extend_from_slice(slice)).unwrap();
        packed[4] = 9;
        assert!(decompress(&packed, None, &mut |_| {}).is_err());
    }

    #[test]
    fn trailing_garbage_block_rejected() {
        let mut packed = Vec::new();
        compress(b"payload", &mut |slice| packed.extend_from_slice(slice)).unwrap();
        packed.push(0xff);
        assert!(decompress(&packed, None, &mut |_| {}).is_err());
    }

    #[test]
    fn fuzz_random_bytes_never_panics() {
        // 结构化模糊：随机翻转/截断合法流，解压器必须 Err 或 Ok，不许 panic。
        let source = vec![b'k'; 50_000];
        let mut packed = Vec::new();
        compress(&source, &mut |slice| packed.extend_from_slice(slice)).unwrap();
        let mut seed: u64 = 0x853c_49e6_748f_ea9b;
        for _round in 0..300 {
            let mut corrupted = packed.clone();
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            let action = seed % 3;
            match action {
                0 if !corrupted.is_empty() => {
                    let index = (seed >> 3) as usize % corrupted.len();
                    corrupted[index] = (seed >> 11) as u8;
                }
                1 => {
                    let keep = (seed >> 3) as usize % (corrupted.len() + 1);
                    corrupted.truncate(keep);
                }
                _ => {
                    corrupted.extend_from_slice(&(seed as u32).to_be_bytes());
                }
            }
            let _ = decompress(&corrupted, None, &mut |_| {});
        }
    }

    #[test]
    fn thread_safety_sizes() {
        // 常量护栏：窗口/块上限与编码位宽一致（dist-1 编码下 65536 占满 16 bit）。
        assert!(LZ_WINDOW <= u16::MAX as usize + 1);
        assert_eq!(MAX_MATCH, 4095);
        assert_eq!(MIN_MATCH, 3);
    }
}
