/**
 * Renders a system prompt template by replacing {{variable}} placeholders
 * with actual values from the provided context.
 */
export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | number | boolean>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value !== undefined ? String(value) : `{{${key}}}`;
  });
}
