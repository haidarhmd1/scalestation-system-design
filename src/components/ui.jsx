export function Slider({ label, value, min, max, step = 1, onChange, display, hint, disabled }) {
  return (
    <label className={`field ${disabled ? 'disabled' : ''}`}>
      <span className="field-row">
        <span className="field-label">{label}</span>
        <span className="field-val mono">{display ?? value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function StepSlider({ label, steps, value, onChange, unit = '', hint, disabled }) {
  const idx = Math.max(0, steps.indexOf(value));
  return (
    <Slider label={label} min={0} max={steps.length - 1} value={idx} onChange={(i) => onChange(steps[i])} display={`${value}${unit}`} hint={hint} disabled={disabled} />
  );
}

export function Toggle({ label, checked, onChange, hint }) {
  return (
    <label className="toggle">
      <span>
        <span className="field-label">{label}</span>
        {hint && <span className="field-hint">{hint}</span>}
      </span>
      <button type="button" role="switch" aria-checked={checked} className={checked ? 'switch on' : 'switch'} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </label>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="field">
      {label && <span className="field-label">{label}</span>}
      <div className="seg">
        {options.map((o) => {
          const v = typeof o === 'object' ? o.value : o;
          const l = typeof o === 'object' ? o.label : o;
          return (
            <button key={v} type="button" className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>
          );
        })}
      </div>
    </div>
  );
}

export function Sparkline({ series, height = 54, max, label, value, unit }) {
  const w = 240;
  const all = series.flatMap((s) => s.data);
  const top = max ?? Math.max(1e-9, ...all) * 1.1;
  const path = (data) =>
    data.map((v, i) => `${i ? 'L' : 'M'}${(i / Math.max(1, data.length - 1)) * w},${height - (Math.min(v, top) / top) * (height - 4) - 2}`).join(' ');
  return (
    <div className="spark">
      <div className="spark-head">
        <span className="mono dim">{label}</span>
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
