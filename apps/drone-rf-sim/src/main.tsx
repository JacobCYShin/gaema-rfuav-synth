import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// no StrictMode: it double-mounts effects, which would create two Cesium viewers
createRoot(document.getElementById('root')!).render(<App />);
