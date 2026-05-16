// Single source of truth for AI provider presets and per-purpose defaults.
// Used by AIProvidersSettings (provider catalog) and AIPurposesTab (model picker
// + recommended temperature/max_tokens prefill).

export interface ProviderPreset {
  base_url: string;
  secret_name: string;
  default_model: string;
  models: string[]; // suggested models, latest first
  help: string;
  label: string;
}

export const PROVIDER_DEFAULTS: Record<string, ProviderPreset> = {
  lovable: {
    label: 'Lovable AI (built-in)',
    base_url: 'https://ai.gateway.lovable.dev/v1/chat/completions',
    secret_name: 'LOVABLE_API_KEY',
    default_model: 'google/gemini-3-flash-preview',
    models: [
      'google/gemini-3-flash-preview',
      'google/gemini-3.1-flash-lite-preview',
      'google/gemini-3.1-pro-preview',
      'google/gemini-2.5-flash',
      'google/gemini-2.5-flash-lite',
      'google/gemini-2.5-pro',
      'openai/gpt-5',
      'openai/gpt-5-mini',
      'openai/gpt-5-nano',
      'openai/gpt-5.2',
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
      'openai/gpt-5.4-pro',
      'openai/gpt-5.5',
      'openai/gpt-5.5-pro',
    ],
    help: 'Built-in Lovable AI Gateway. LOVABLE_API_KEY is auto-provisioned — no setup needed.',
  },
  google: {
    label: 'Google Gemini (direct)',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    secret_name: 'GOOGLE_AI_API_KEY',
    default_model: 'gemini-flash-latest',
    models: [
      'gemini-flash-latest',
      'gemini-flash-lite-latest',
      'gemini-pro-latest',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.5-pro',
    ],
    help: 'Google Gemini direct API (OpenAI-compatible). Free tier. Get key at aistudio.google.com/apikey.',
  },
  openrouter: {
    label: 'OpenRouter',
    base_url: 'https://openrouter.ai/api/v1/chat/completions',
    secret_name: 'OPENROUTER_API_KEY',
    // openrouter/auto = router that auto-picks a live free model (best default,
    // immune to individual model deprecations).
    default_model: 'openrouter/auto',
    models: [
      // --- Currently live FREE models (verified May 2026) ---
      'openrouter/auto',
      'openai/gpt-oss-120b:free',
      'openai/gpt-oss-20b:free',
      'deepseek/deepseek-v4-flash:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'nvidia/nemotron-3-nano-30b-a3b:free',
      'nvidia/nemotron-nano-9b-v2:free',
      'z-ai/glm-4.5-air:free',
      'minimax/minimax-m2.5:free',
      'google/gemma-4-31b-it:free',
      // --- Paid premium fallbacks ---
      'anthropic/claude-sonnet-4',
      'anthropic/claude-3.5-sonnet',
      'openai/gpt-4o-mini',
      'openai/gpt-5',
      'x-ai/grok-2-1212',
    ],
    help: 'Free tier: pick "openrouter/auto" (auto-routes to a live free model) or any :free model. Browse all at openrouter.ai/models?free=true. Get key at openrouter.ai/keys.',
  },
  groq: {
    label: 'Groq',
    base_url: 'https://api.groq.com/openai/v1/chat/completions',
    secret_name: 'GROQ_API_KEY',
    default_model: 'llama-3.3-70b-versatile',
    models: [
      'llama-3.3-70b-versatile',
      'llama-3.1-8b-instant',
      'llama-3.2-90b-vision-preview',
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'deepseek-r1-distill-llama-70b',
    ],
    help: 'Ultra-fast inference, generous free tier. Get key at console.groq.com/keys.',
  },
  together: {
    label: 'Together AI',
    base_url: 'https://api.together.xyz/v1/chat/completions',
    secret_name: 'TOGETHER_API_KEY',
    default_model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
      'meta-llama/Llama-Vision-Free',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
      'mistralai/Mixtral-8x7B-Instruct-v0.1',
      'Qwen/Qwen2.5-72B-Instruct-Turbo',
    ],
    help: 'Free Llama models available. Get key at api.together.xyz/settings/api-keys.',
  },
  deepseek: {
    label: 'DeepSeek',
    base_url: 'https://api.deepseek.com/v1/chat/completions',
    secret_name: 'DEEPSEEK_API_KEY',
    default_model: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    help: 'Very cheap. Get key at platform.deepseek.com.',
  },
  mistral: {
    label: 'Mistral AI',
    base_url: 'https://api.mistral.ai/v1/chat/completions',
    secret_name: 'MISTRAL_API_KEY',
    default_model: 'mistral-small-latest',
    models: [
      'mistral-small-latest',
      'mistral-medium-latest',
      'mistral-large-latest',
      'open-mistral-nemo',
      'codestral-latest',
      'pixtral-large-latest',
    ],
    help: 'Mistral AI. Get key at console.mistral.ai/api-keys.',
  },
  anthropic: {
    label: 'Anthropic Claude',
    base_url: 'https://api.anthropic.com/v1/chat/completions',
    secret_name: 'ANTHROPIC_API_KEY',
    default_model: 'claude-sonnet-4-20250514',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'claude-3-5-sonnet-20241022',
      'claude-3-5-haiku-20241022',
    ],
    help: 'Anthropic Claude (OpenAI-compatible endpoint). Get key at console.anthropic.com.',
  },
  xai: {
    label: 'xAI Grok',
    base_url: 'https://api.x.ai/v1/chat/completions',
    secret_name: 'XAI_API_KEY',
    default_model: 'grok-2-1212',
    models: ['grok-2-1212', 'grok-2-vision-1212', 'grok-beta'],
    help: 'xAI Grok (OpenAI-compatible). Get key at console.x.ai.',
  },
  ollama: {
    label: 'Ollama (self-hosted)',
    // Example points at the user's VPS. Replace host if you move it.
    base_url: 'https://ai.yacispl.com/v1/chat/completions',
    secret_name: 'OLLAMA_API_KEY',
    default_model: 'qwen2.5:latest',
    models: ['qwen2.5:latest', 'llama3.1:latest'],
    help: 'Self-hosted Ollama. Base URL can be the host root (e.g. https://ai.yacispl.com) or the full /v1/chat/completions path — the dispatcher will auto-append the path if missing. API key is optional. Pull models on the server first: `ollama pull qwen2.5`.',
  },
  openai_compatible: {
    label: 'Custom OpenAI-compatible',
    base_url: '',
    secret_name: 'CUSTOM_AI_API_KEY',
    default_model: '',
    models: [],
    help: 'Any OpenAI-compatible endpoint (vLLM, LM Studio, etc.).',
  },
};

export interface PurposeDefaults {
  temperature: number;
  max_tokens: number;
  hint: string;
}

// Recommended generation params per purpose. Used to prefill in Purposes editor.
// Tightened to cut API spend; users can still override per-purpose.
export const PURPOSE_DEFAULTS: Record<string, PurposeDefaults> = {
  whatsapp_reply: { temperature: 0.6, max_tokens: 350, hint: 'Conversational, short replies' },
  lead_nurture: { temperature: 0.7, max_tokens: 250, hint: 'Warm, persuasive nudges' },
  lead_score: { temperature: 0.2, max_tokens: 500, hint: 'Deterministic JSON scoring' },
  campaign_draft: { temperature: 0.8, max_tokens: 800, hint: 'Creative marketing copy' },
  template_generate: { temperature: 0.4, max_tokens: 600, hint: 'Structured WhatsApp templates' },
  dashboard_insight: { temperature: 0.3, max_tokens: 800, hint: 'Analytical, factual summaries' },
  fitness_plan: { temperature: 0.5, max_tokens: 2500, hint: 'Detailed structured plans' },
  review_reply: { temperature: 0.6, max_tokens: 250, hint: 'Personal, on-brand replies' },
  automation_rule: { temperature: 0.5, max_tokens: 200, hint: 'Short rule-driven sends' },
};

// Heuristic: returns true when the model id strongly suggests a free / low-cost tier.
// Used by the Purposes editor to surface a "FREE / CHEAP" badge and a one-click
// "Use cheapest available model" picker.
export function isCheapModel(model: string): boolean {
  if (!model) return false;
  const m = model.toLowerCase();
  return (
    m.includes(':free') ||
    m.includes('-free') ||
    m.includes('flash-lite') ||
    m.includes('lite-latest') ||
    m.includes('nano') ||
    m.includes('mini') ||
    m.includes('haiku') ||
    m.includes('flash') ||
    m.includes('8b') ||
    m.includes('3b') ||
    m.includes('phi3')
  );
}

// Pick the first model in the provider's catalog that looks free/cheap.
// Falls back to the provider default if nothing matches.
export function cheapestModelFor(provider: string): string {
  const preset = PROVIDER_DEFAULTS[provider];
  if (!preset) return '';
  return preset.models.find(isCheapModel) ?? preset.default_model;
}

// Mirror server-side normalizer. Returns the model that will actually be sent
// to the underlying provider after dispatcher cleanup.
export function normalizeModelForProvider(provider: string, model: string): string {
  if (!model) return model;
  if (provider === 'google') {
    const m = model.replace(/^google\//, '');
    const map: Record<string, string> = {
      'gemini-3-flash-preview': 'gemini-flash-latest',
      'gemini-3.1-flash-lite-preview': 'gemini-flash-lite-latest',
      'gemini-3.1-pro-preview': 'gemini-pro-latest',
      'gemini-2.0-flash': 'gemini-flash-latest',
    };
    return map[m] ?? m;
  }
  if (provider === 'lovable' && !model.includes('/')) {
    return `google/${model}`;
  }
  return model;
}
