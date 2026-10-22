import '@mantine/core/styles.css';
import '@mantine/charts/styles.css';
import '@mantine/spotlight/styles.css';
import '@fontsource-variable/inter';
import './theme.css';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { setKey } from './api.js';

const k = location.hash.match(/^#k=([\w-]+)$/);
if (k) { setKey(k[1]); history.replaceState(null, '', '/'); }

createRoot(document.getElementById('root')).render(<App />);
