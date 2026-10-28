import type { Milestone, MilestoneStatus, Risk, SessionStatus, TitleStatus } from '../lib/types';
import { MILESTONE_STATUS, RISK_LABEL, SESSION_STATUS, THESIS_STATUS, TITLE_STATUS, effectiveStatus } from '../lib/labels';
import { Badge } from './ui';

export const MilestoneBadge = ({ m }: { m: Pick<Milestone, 'status' | 'tenggat'> }) => {
  const s = effectiveStatus(m);
  return <Badge tone={MILESTONE_STATUS[s].tone}>{MILESTONE_STATUS[s].label}</Badge>;
};
export const MilestoneStatusBadge = ({ s }: { s: MilestoneStatus }) => <Badge tone={MILESTONE_STATUS[s].tone}>{MILESTONE_STATUS[s].label}</Badge>;
export const SessionBadge = ({ s }: { s: SessionStatus }) => <Badge tone={SESSION_STATUS[s].tone}>{SESSION_STATUS[s].label}</Badge>;
export const TitleBadge = ({ s }: { s: TitleStatus }) => <Badge tone={TITLE_STATUS[s].tone}>{TITLE_STATUS[s].label}</Badge>;
export const ThesisBadge = ({ s }: { s: string }) => <Badge tone={THESIS_STATUS[s]?.tone ?? 'neutral'}>{THESIS_STATUS[s]?.label ?? s}</Badge>;
export const RiskLabel = ({ r }: { r: Risk }) => <span className={`risk ${r}`}>{RISK_LABEL[r]}</span>;
