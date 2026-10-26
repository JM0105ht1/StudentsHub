/**
 * Configuração Segura da API Gemini para Netlify Functions
 * 
 * Regras Estritas:
 * 1. O modelo é OBRIGATORIAMENTE lido de process.env.GEMINI_MODEL.
 * 2. Nenhum nome de modelo é hardcoded no código.
 * 3. Se GEMINI_MODEL estiver ausente, lança erro explícito de configuração.
 * 4. Apenas executado no ambiente de backend (Netlify Functions). NUNCA no cliente.
 */

export interface GeminiConfig {
  apiKey: string;
  model: string;
}

export const getGeminiConfig = (): GeminiConfig => {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = (process.env.GEMINI_MODEL || '').trim();

  if (!apiKey || apiKey.trim() === '') {
    if (process.env.NODE_ENV === 'test') {
      return {
        apiKey: 'test-mock-gemini-key',
        model: model || 'test-model',
      };
    }
    throw new Error('Variável GEMINI_API_KEY não configurada no ambiente do servidor.');
  }

  // O modelo é obrigatório e configurável (sem valor por omissão arbitrário no código)
  if (!model) {
    throw new Error('Variável GEMINI_MODEL não configurada no ambiente do servidor.');
  }

  return {
    apiKey: apiKey.trim(),
    model,
  };
};
