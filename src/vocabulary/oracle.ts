export const ORACLE_NAMESPACE = 'urn:oracle:ns:v1:';

export const ORACLE_TERMS = {
  Domain: `${ORACLE_NAMESPACE}Domain`,
  Policy: `${ORACLE_NAMESPACE}Policy`,
  Action: `${ORACLE_NAMESPACE}Action`,
  governs: `${ORACLE_NAMESPACE}governs`,
  requiresHumanReview: `${ORACLE_NAMESPACE}requiresHumanReview`,
  version: `${ORACLE_NAMESPACE}version`,
} as const;
