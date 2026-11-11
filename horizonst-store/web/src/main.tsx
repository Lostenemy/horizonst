import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './components/AuthProvider';
import './styles.css';
import './commercial-layout.css';
import './resource-center.css';
import './commercial-review.css';

const root = document.getElementById('root')!;
const app = (
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
if (root.dataset.prerendered === 'true') ReactDOM.hydrateRoot(root, app);
else ReactDOM.createRoot(root).render(app);
