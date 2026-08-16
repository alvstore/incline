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
          `\n\nCRITICAL: You MUST return a JSON object with a "templates" key containing an array of objects. 
          Return ONLY valid JSON. The JSON must follow this exact schema: 
          { 
            "templates": [ 
              { 
                "event": "event_name", 
                "name": "template_name", 
                "category": "UTILITY|MARKETING|AUTHENTICATION", 
                "body_text": "...", 
                "variables": ["var1", "var2"] 
              } 
            ] 
          }`,
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
