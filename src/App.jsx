import { useEffect, useState } from 'react';
import Catalogue from './components/Catalogue.jsx';
import Simulator from './components/Simulator.jsx';
import { GlossaryProvider, useGlossary } from './components/Glossary.jsx';

function GlossaryButton() {
  const { openIndex } = useGlossary();
  return <button className="btn ghost small gl-open" onClick={openIndex}><span className="info static">i</span> Glossary</button>;
}

const readTab = () => (window.location.hash.startsWith('#sim') ? 'sim' : 'atlas');

export default function App() {
  const [tab, setTab] = useState(readTab);
  const [preset, setPreset] = useState(null);

  useEffect(() => {
    const on = () => setTab(readTab());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (t) => {
    window.location.hash = t === 'sim' ? 'sim' : 'atlas';
    setTab(t);
    window.scrollTo(0, 0);
  };

  return (
    <GlossaryProvider>
    <div className="app">
      <nav className="topnav">
        <div className="brand">
          <span className="brand-signal"><i /><i /><i /></span>
          <span className="brand-name">SIGNAL BOX</span>
          <span className="brand-sub mono">system design atlas</span>
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'atlas'} className={tab === 'atlas' ? 'on' : ''} onClick={() => go('atlas')}>
            <span className="mono">01</span> Network Map
          </button>
          <button role="tab" aria-selected={tab === 'sim'} className={tab === 'sim' ? 'on' : ''} onClick={() => go('sim')}>
            <span className="mono">02</span> Simulator
          </button>
        </div>
        <GlossaryButton />
      </nav>
      {tab === 'atlas' ? (
        <Catalogue onTrySim={(patch, name) => { setPreset({ patch, name, key: Date.now() }); go('sim'); }} />
      ) : (
        <Simulator preset={preset} />
      )}
    </div>
    </GlossaryProvider>
  );
}
