import { Purpose, GenerateOnceResult, GenerateOnceOptions, loadPurpose, generateOnce } from "./ai-runtime.ts";

/**
 * Enhanced generateOnce that specifically handles tool-call fallbacks for 
 * Lovable AI Gateway which may ignore tool_choice.
 */
export async function generateWithToolFallback(opts: GenerateOnceOptions): Promise<GenerateOnceResult> {
  try {
    const r = await generateOnce(opts);
    
    // If tools were provided and forced, but no tool call was returned
    if (opts.tools?.length && opts.toolChoice && !r.toolCallArgs) {
      console.warn(`[ai-tool-fallback] Forced tool call missing in primary attempt for ${opts.purpose}. Retrying in JSON mode...`);
      
      const TOOL_SCHEMA = Array.isArray(opts.tools) ? opts.tools[0] : opts.tools;
      const params = TOOL_SCHEMA?.function?.parameters?.properties?.templates?.items?.properties || 
                     TOOL_SCHEMA?.function?.parameters?.properties || {};
      
      const jsonRetry = await generateOnce({
        ...opts,
        userMessage: opts.userMessage + 
          `\n\nIMPORTANT: Return ONLY a valid JSON object. Do not include prose, markdown blocks, or explanations. 
          The JSON must follow this EXACT schema (including the "templates" wrapper): { "templates": [ { "event": "...", "name": "...", "category": "...", "body_text": "...", "variables": ["..."] } ] }`,
        responseFormat: "json",
        tools: undefined,
        toolChoice: undefined
      });
      
      return {
        ...jsonRetry,
        toolCallArgs: jsonRetry.json
      };
    }
    
    return r;
  } catch (e) {
    throw e;
  }
}
