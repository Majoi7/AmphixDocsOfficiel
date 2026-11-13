import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { startUploadDiagnostics } from './lib/upload-diagnostics';
import './index.css';

startUploadDiagnostics();
createRoot(document.getElementById('root')!).render(<App />);
