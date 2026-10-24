export const mappingPolicyProposal = {
  id: "mapping-policy-r0",
  status: "draft-not-approved",
  approvalEnabled: false,
  applicationEnabled: false,
  approach:
    "Preserve original historical facts; propose separately classified attribution overlays. Keep task linking in its existing guarded workflow.",
  next: "Owner review of source-custody, independent decision and application rules is required before a mapping approval/application workflow can be activated.",
} as const;
export function readinessFindings({
  blocked,
  matches,
  observations,
  drift,
  estateActive,
}: {
  blocked: number;
  matches: boolean;
  drift: number;
  estateActive: boolean;
  observations: {
    total: number;
    concerns: number;
    insufficient: number;
    authorizationChanged: number;
    authorizedCorroborated: number;
  };
}) {
  const items: { code: string; message: string }[] = [];
  const add = (code: string, message: string) => items.push({ code, message });
  if (!estateActive)
    add(
      "ESTATE_INACTIVE",
      "The estate is inactive. Review access does not authorize operational application.",
    );
  if (blocked)
    add(
      "MAPPING_ISSUES",
      `${blocked} mapping row(s) currently have validation issues. Correct the proposal and save a new review.`,
    );
  if (drift)
    add(
      "RECORD_DRIFT",
      `${drift} record(s) differ from the saved validation snapshot. Inspect current details before a separate decision.`,
    );
  if (!matches)
    add(
      "SOURCE_MISMATCH",
      "Selected source bytes do not match the saved declaration. Resolve the original source or save a corrected manifest.",
    );
  if (!observations.total)
    add(
      "NO_OBSERVATIONS",
      "No independent provenance observations exist for this selected source check.",
    );
  if (observations.concerns)
    add(
      "REVIEWER_CONCERNS",
      `${observations.concerns} current reviewer observation(s) raise concerns. A positive observation does not cancel them.`,
    );
  if (observations.insufficient)
    add(
      "INSUFFICIENT_EVIDENCE",
      `${observations.insufficient} current reviewer observation(s) report insufficient evidence.`,
    );
  if (observations.authorizationChanged)
    add(
      "REVIEWER_ACCESS_CHANGED",
      `${observations.authorizationChanged} reviewer(s) no longer have current review authority. Their recorded statements remain visible, including adverse observations.`,
    );
  if (!observations.authorizedCorroborated)
    add(
      "NO_CURRENT_CORROBORATION",
      "No currently authorized reviewer has a current corroborating observation for this check.",
    );
  add(
    "AUTHENTICITY_CRITERIA_OPEN",
    "Source authenticity and controlled-document custody criteria are not certified by this report.",
  );
  add(
    "POLICY_NOT_APPROVED",
    "Mapping policy R0 is a proposal. Approval and application are not enabled.",
  );
  return items;
}
