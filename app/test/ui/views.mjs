// Shared by the spec files that open the app's views.
// Sidebar label and route of every view, in sidebar order.
export const VIEWS = [['Dashboard', 'dashboard'], ['History', 'history'], ['Projects', 'projects'], ['Catalog', 'catalog'], ['Sessions', 'sessions'], ['Runs', 'runs'], ['Insights', 'insights'], ['Evals', 'evals'],
  ['Global setup', 'agents'], ['Agent settings', 'agent-settings'], ['Rules', 'rules'], ['Extensions', 'extensions'], ['Accounts', 'accounts'], ['Automations', 'automations'], ['Preferences', 'settings']];
// A view is up once its CLI block shows; Agent settings has none, its count line shows instead, and Evals, Extensions and
// Accounts keep it in a fold (How evals work, Command, Usage limits), whose summary shows instead.
export const ready = (page) => page.getByText('CLI', { exact: true }).or(page.getByText(/settings with a suggestion differ from it/))
  .or(page.getByText('How evals work', { exact: true }))
  .or(page.locator('summary').getByText('Command', { exact: true })).or(page.locator('summary').getByText('Usage limits', { exact: true })).filter({ visible: true });
export const nav = (page, view) => page.getByRole('navigation', { name: 'Views' }).getByRole('link', { name: view });
