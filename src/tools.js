// DSH supports a smaller JSON Schema vocabulary than MCP. Preserve the original
// schema separately and enforce its union and array-size constraints before dispatch.
export function harnessSchema(schema) {
  const result = {};
  for (const key of ['type', 'description', 'title', 'enum', 'const', 'default', 'required', 'additionalProperties']) if (schema[key] !== undefined) result[key] = schema[key];
  if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, value]) => [key, harnessSchema(value)]));
  if (schema.items) result.items = harnessSchema(schema.items);
  if (result.type === 'object') result.additionalProperties ??= true;
  return result;
}
export function validateMcp(schema, value, at = 'arguments') {
  const errors = [];
  if (schema.anyOf && !schema.anyOf.some(branch => validateMcp(branch, value, at).length === 0)) errors.push(`${at}: requires a saved connectionId/connectionName or an inline host and username`);
  if (schema.type) {
    const matches = schema.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : schema.type === 'array' ? Array.isArray(value) : schema.type === 'integer' ? Number.isSafeInteger(value) : schema.type === 'null' ? value === null : typeof value === schema.type;
    if (!matches) return [...errors, `${at}: expected ${schema.type}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: unsupported value`);
  if (schema.required) for (const key of schema.required) if (!Object.hasOwn(value || {}, key)) errors.push(`${at}.${key}: required`);
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) for (const [key, item] of Object.entries(value)) {
    if (schema.properties[key]) errors.push(...validateMcp(schema.properties[key], item, `${at}.${key}`));
    else if (schema.additionalProperties === false) errors.push(`${at}.${key}: unknown property`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: too few items`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: too many items`);
    if (schema.items) value.forEach((item, index) => errors.push(...validateMcp(schema.items, item, `${at}[${index}]`)));
  }
  return errors;
}
export function toolDefinition(upstream, service) {
  return {
    name: upstream.name,
    description: upstream.description.replaceAll('DBX', 'Harness SSH'),
    parameters: harnessSchema(upstream.inputSchema),
    output: { schema: {}, render: (_args, value) => {
      if (Array.isArray(value?.content)) return value.content.filter(block => block.type === 'text').map(block => ({ type: 'text', text: block.text }));
      return [{ type: 'text', text: JSON.stringify(value) }];
    } },
    async execute(args, exec) {
      const errors = validateMcp(upstream.inputSchema, args);
      if (errors.length) throw new Error(errors.join('; '));
      const result = await service.callTool(upstream.name, args, { signal: exec.signal });
      if (result?.isError) throw new Error((result.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n') || 'Upstream SSH tool failed.');
      return result;
    },
  };
}
