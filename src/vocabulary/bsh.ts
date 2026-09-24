export const BSH_NAMESPACE = 'urn:bsh:ns:v1:';

export const BSH_TERMS = {
  Domain: `${BSH_NAMESPACE}Domain`,
  Policy: `${BSH_NAMESPACE}Policy`,
  Action: `${BSH_NAMESPACE}Action`,
  governs: `${BSH_NAMESPACE}governs`,
  requiresHumanReview: `${BSH_NAMESPACE}requiresHumanReview`,
  version: `${BSH_NAMESPACE}version`,
  reason: `${BSH_NAMESPACE}reason`,
  scope: `${BSH_NAMESPACE}scope`,
  source: `${BSH_NAMESPACE}source`,
} as const;
