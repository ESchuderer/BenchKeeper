/**
 * An Agent Skills name, which is also its folder's (https://agentskills.io/specification): 1 to 64 of a to z and 0 to 9,
 * single hyphens inside. One pattern, so the JSON Schema documents carry it.
 */
export const SKILL_NAME = /^(?=.{1,64}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a name is an Agent Skills name. */
export const skillName = (name: string): boolean => SKILL_NAME.test(name);
