import { useEffect, useState } from 'react';
import Catalogue from './components/Catalogue.jsx';
import Simulator from './components/Simulator.jsx';
import Build from './components/Build.jsx';
import Networking from './components/Networking.jsx';
import Capacity from './components/Capacity.jsx';
import { GlossaryProvider, useGlossary } from './components/Glossary.jsx';
import Project from './components/Project.jsx';
import { STUDIO, api, layoutOf } from './studio.js';

function GlossaryButton() {
  const { openIndex } = useGlossary();
  return <button className="btn ghost small gl-open" onClick={openIndex}><span className="info static">i</span> Glossary</button>;
}

const readTab = () => {
  const h = window.location.hash;
  if (h.startsWith('#sim')) return 'sim';
  if (h.startsWith('#build')) return 'build';
  if (h.startsWith('#net')) return 'net';
  if (h.startsWith('#cap')) return 'cap';
  if (STUDIO && (h.startsWith('#project') || !h || h === '#')) return 'project';
  return 'atlas';
};

export default function App() {
  const [tab, setTab] = useState(readTab);
  const [preset, setPreset] = useState(null);
  const [patternRequest, setPatternRequest] = useState(null);
  const trySim = (patch, name) => { setPreset({ patch, name, key: Date.now() }); go('sim'); };
  const openPattern = (id) => { setPatternRequest({ id, key: Date.now() }); go('atlas'); };
  const [buildRequest, setBuildRequest] = useState(null);
  const openBuild = (id) => { setBuildRequest({ id, key: Date.now() }); go('build'); };

  // Studio mode: the user's own project, served by the scalestation CLI.
  const [project, setProject] = useState(null);
  const [projectErr, setProjectErr] = useState(null);
  useEffect(() => {
    if (!STUDIO) return;
    api.project().then((p) => {
      setProject(p);
      setPreset({ patch: layoutOf(p), name: p.name, key: Date.now() }); // the Simulator opens on their system
    }).catch((e) => setProjectErr(e.message));
  }, []);
  const studio = STUDIO && project ? {
    name: project.name,
    onSave: async (cfg) => {
      const { calib, ...layout } = cfg;
      await api.saveLayout(layout);
      setProject((p) => ({ ...p, simulator: layout }));
    },
  } : null;

  useEffect(() => {
    const on = () => setTab(readTab());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const go = (t) => {
    window.location.hash = t;
    setTab(t);
    window.scrollTo(0, 0);
  };

  return (
    <GlossaryProvider>
    <div className="app">
      <nav className="topnav">
        <div className="brand">
          <span className="brand-signal"><i /><i /><i /></span>
          <span className="brand-name">SCALESTATION</span>
          <span className="brand-sub mono">{STUDIO ? `studio · ${project?.name || 'your project'}` : 'system design simulator'}</span>
        </div>
        <div className="tabs" role="tablist">
          {STUDIO && (
            <button role="tab" aria-selected={tab === 'project'} className={tab === 'project' ? 'on' : ''} onClick={() => go('project')}>
              <span className="mono">00</span> Your Project
            </button>
          )}
          <button role="tab" aria-selected={tab === 'atlas'} className={tab === 'atlas' ? 'on' : ''} onClick={() => go('atlas')}>
            <span className="mono">01</span> Network Map
          </button>
          <button role="tab" aria-selected={tab === 'sim'} className={tab === 'sim' ? 'on' : ''} onClick={() => go('sim')}>
            <span className="mono">02</span> Simulator
          </button>
          <button role="tab" aria-selected={tab === 'build'} className={tab === 'build' ? 'on' : ''} onClick={() => go('build')}>
            <span className="mono">03</span> Build Your Own
          </button>
        </div>
        <div className="nav-tools">
          <button className={`btn ghost small gl-open net-open ${tab === 'net' ? 'on' : ''}`} onClick={() => go('net')} aria-current={tab === 'net' ? 'page' : undefined}>
            <svg className="net-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.4" d="M2 3.5h12M2 8h12M2 12.5h12" /><circle cx="5" cy="3.5" r="1.4" fill="currentColor" /><circle cx="10.5" cy="8" r="1.4" fill="currentColor" /><circle cx="7" cy="12.5" r="1.4" fill="currentColor" /></svg>
            Networking
          </button>
          <button className={`btn ghost small gl-open net-open ${tab === 'cap' ? 'on' : ''}`} onClick={() => go('cap')} aria-current={tab === 'cap' ? 'page' : undefined}>
            <svg className="net-ico" viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" d="M2.5 11.5a5.5 5.5 0 1 1 11 0" /><path stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" d="M8 11.5l3-4" /><circle cx="8" cy="11.5" r="1.3" fill="currentColor" /></svg>
            Capacity
          </button>
          <GlossaryButton />
        </div>
      </nav>
      {tab === 'atlas' && <Catalogue onTrySim={trySim} openRequest={patternRequest} onBuild={() => go('build')} onNetworking={() => go('net')} />}
      {tab === 'project' && (project
        ? <Project project={project} setProject={setProject} onOpenSim={trySim} />
        : <div className="net-page"><p className={projectErr ? 'bad-text' : 'dim'}>{projectErr || 'Loading your project…'}</p></div>)}
      {tab === 'sim' && <Simulator preset={preset} studio={studio} />}
      {tab === 'build' && <Build onTrySim={trySim} onOpenPattern={openPattern} openRequest={buildRequest} onCapacity={() => go('cap')} />}
      {tab === 'net' && <Networking onOpenPattern={openPattern} />}
      {tab === 'cap' && <Capacity onTrySim={trySim} onOpenBuild={openBuild} />}
      <footer className="site-foot">
        <div className="foot-brand">
          <span className="brand-signal"><i /><i /><i /></span>
          <span>Built by <b>Haidar Hammoud</b></span>
        </div>
        <nav className="foot-links" aria-label="Author links">
          <a href="https://github.com/haidarhmd1" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
            <span>GitHub</span><span className="mono dim">@haidarhmd1</span>
          </a>
          <a href="https://www.linkedin.com/in/haidarhmd" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M13.63 0H2.37A2.37 2.37 0 000 2.37v11.26A2.37 2.37 0 002.37 16h11.26A2.37 2.37 0 0016 13.63V2.37A2.37 2.37 0 0013.63 0zM4.85 13.63H2.48V6h2.37zM3.66 4.96a1.37 1.37 0 110-2.75 1.37 1.37 0 010 2.75zm9.97 8.67h-2.37V9.92c0-.89-.02-2.03-1.23-2.03-1.24 0-1.43.97-1.43 1.96v3.78H6.23V6h2.27v1.04h.03c.32-.6 1.09-1.23 2.25-1.23 2.4 0 2.85 1.58 2.85 3.64z"/></svg>
            <span>LinkedIn</span><span className="mono dim">/in/haidarhmd</span>
          </a>
        </nav>
      </footer>
    </div>
    </GlossaryProvider>
  );
}
