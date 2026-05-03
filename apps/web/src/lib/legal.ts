export type LegalConfig = {
  operatorName: string;
  operatorEmail: string;
  operatorAddress: string;
  operatorCountry: string;
  governingLaw: string;
  vatId: string | null;
  commercialRegister: string | null;
  supportUrl: string | null;
  isConfigured: boolean;
};

function readEnv(name: string) {
  return process.env[name]?.trim() ?? '';
}

export function getLegalConfig(): LegalConfig {
  const operatorName = readEnv('NEXT_PUBLIC_LEGAL_OPERATOR_NAME');
  const operatorEmail = readEnv('NEXT_PUBLIC_LEGAL_OPERATOR_EMAIL');
  const operatorAddress = readEnv('NEXT_PUBLIC_LEGAL_OPERATOR_ADDRESS');
  const operatorCountry = readEnv('NEXT_PUBLIC_LEGAL_OPERATOR_COUNTRY') || 'Germany';
  const governingLaw = readEnv('NEXT_PUBLIC_LEGAL_GOVERNING_LAW') || operatorCountry;
  const vatId = readEnv('NEXT_PUBLIC_LEGAL_VAT_ID') || null;
  const commercialRegister = readEnv('NEXT_PUBLIC_LEGAL_COMMERCIAL_REGISTER') || null;
  const supportUrl = readEnv('NEXT_PUBLIC_LEGAL_SUPPORT_URL') || null;
  const isConfigured = Boolean(operatorName && operatorEmail && operatorAddress);

  return {
    operatorName: operatorName || 'Self-hosted BotParty operator',
    operatorEmail: operatorEmail || 'legal@localhost.invalid',
    operatorAddress: operatorAddress || 'Operator address not configured for this deployment.',
    operatorCountry,
    governingLaw,
    vatId,
    commercialRegister,
    supportUrl,
    isConfigured,
  };
}
