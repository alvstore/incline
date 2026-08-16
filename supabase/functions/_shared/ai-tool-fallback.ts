import { Purpose, GenerateOnceResult, GenerateOnceOptions, loadPurpose } from "./ai-runtime.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Enhanced generateOnce that specifically handles tool-call fallbacks for 
 * Lovable AI Gateway which may ignore tool_choice.
 */
export async function generateWithToolFallback(opts: GenerateOnceOptions): Promise<GenerateOnceResult> {
  const { generateOnce } = await import("./ai-runtime.ts");
  
  try {
    const r = await generateOnce(opts);
    
    // If tools were provided and forced, but no tool call was returned
    if (opts.tools?.length && opts.toolChoice && !r.toolCallArgs) {
      console.warn(`[ai-tool-fallback] Forced tool call missing in primary attempt for ${opts.purpose}. Retrying in JSON mode...`);
      
      const TOOL_SCHEMA = Array.isArray(opts.tools) ? opts.tools[0] : opts.tools;
      const functionName = TOOL_SCHEMA?.function?.name || "response";
      const params = TOOL_SCHEMA?.function?.parameters?.properties || {};
      
      const jsonRetry = await generateOnce({
        ...opts,
        userMessage: opts.userMessage + 
          `\n\nIMPORTANT: Return ONLY a valid JSON object. Do not include prose, markdown blocks, or explanations. 
          The JSON must follow this schema: ${JSON.stringify(params)}`,
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
