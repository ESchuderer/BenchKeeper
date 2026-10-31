// Shared by the spec files that open the app's views.
// Sidebar label and route of every view, in sidebar order.
export const VIEWS = [['Dashboard', 'dashboard'], ['History', 'history'], ['Projects', 'projects'], ['Catalog', 'catalog'], ['Sessions', 'sessions'], ['Runs', 'runs'], ['Insights', 'insights'], ['Evals', 'evals'],
  ['Global setup', 'agents'], ['Agent settings', 'agent-settings'], ['Rules', 'rules'], ['Extensions', 'extensions'], ['Accounts', 'accounts'], ['Automations', 'automations'], ['Preferences', 'settings']];
// A view is up once its CLI block shows; Agent settings has none, its count line shows instead, Evals keeps it in its
// How evals work fold, whose summary shows instead, Accounts in its Usage limits fold, whose summary shows instead,
// Extensions and Runs in their Command folds, so the loaded Claude Code section or Orchestrated runs shows instead, and
// Preferences in its Advanced tab, so the tier strip switch of its Views tab shows instead.
export const ready = (page) => page.getByText('CLI', { exact: true }).or(page.getByText(/settings with a suggestion differ from it/))
  .or(page.getByText('How evals work', { exact: true })).or(page.locator('summary').getByText('Usage limits', { exact: true }))
  .or(page.getByRole('region', { name: 'Claude Code extensions', exact: true })).or(page.getByRole('region', { name: 'Orchestrated runs', exact: true }))
  .or(page.getByRole('switch', { name: /^Terminal tier strip: / })).filter({ visible: true });
export const nav = (page, view) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view });
