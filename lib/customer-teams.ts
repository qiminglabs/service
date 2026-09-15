// Shared by customer maintenance and assessment routing.
export const responsibleTeams = ['金融', '商业', '港澳', '其他'] as const;
export type ResponsibleTeam = (typeof responsibleTeams)[number];
