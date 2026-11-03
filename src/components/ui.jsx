import { Info } from './Glossary.jsx';

export function Slider({ label, value, min, max, step = 1, onChange, display, hint, disabled, info }) {
  return (
    <label className={`field ${disabled ? 'disabled' : ''}`}>
      <span className="field-row">
        <span className="field-label">{label}{info && <Info term={info} label={label} />}</span>
        <span className="field-val mono">{display ?? value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function StepSlider({ label, steps, value, onChange, unit = '', hint, disabled, info }) {
  const idx = Math.max(0, steps.indexOf(value));
  return (
    <Slider label={label} min={0} max={steps.length - 1} value={idx} onChange={(i) => onChange(steps[i])} display={`${value}${unit}`} hint={hint} disabled={disabled} info={info} />
  );
}

export function Toggle({ label, checked, onChange, hint, info }) {
  return (
    <div className="toggle" onClick={() => onChange(!checked)}>
      <span>
        <span className="field-label">{label}{info && <Info term={info} label={label} />}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} className={checked ? 'switch on' : 'switch'} onClick={(e) => { e.stopPropagation(); onChange(!checked); }}>
        <i />
      </button>
    </div>
  );
}

export function Segmented({ options, value, onChange, label, info }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}{info && <Info term={info} label={label} />}</span>}
      <div className="seg">
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          const term = typeof o === 'object' ? o.info : null;
          if (!term) return <button key={v} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>;
          return (
            <span key={v} className="seg-opt">
              <button type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
              <Info term={term} label={l} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({ series, height = 54, max, label, value, unit, info }) {
  const w = 240;
  const all = series.flatMap((s) => s.data);
  const top = max ?? Math.max(1e-9, ...all) * 1.1;
  const path = (data) =>
    data.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, data.length - 1)) * w},${height - (Math.min(v, top) / top) * (height - 4) - 2}`).join(' ');
  return (
    <div className="spark">
      <div className="spark-head">
        <span className="mono dim">{label}{info && <Info term={info} label={label} />}</span>
        <span className="mono">{value}{unit}</span>
      </div>
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="spark-svg">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={height * f} y2={height * f} className="spark-grid" />)}
        {series.map((s) => s.data.length > 1 && (
          <g key={s.name}>
            {s.fill && <path d={`${path(s.data)} L${w},${height} L0,${height} Z`} fill={s.color} opacity="0.12" />}
            <path d={path(s.data)} fill="none" stroke={s.color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div className="spark-legend">
          {series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}
        </div>
      )}
    </div>
  );
}

// Hover / keyboard-focus popover. `align` keeps cards on screen near edges.
export function Popover({ title, content, children, align = 'center', width = 280 }) {
  return (
    <span className={`pop pop-${align}`}>
      {children}
      <span role="tooltip" className="pop-card" style={{ width }}>
        {title && <span className="pop-title mono">{title}</span>}
        <span className="pop-body">{content}</span>
      </span>
    </span>
  );
}
