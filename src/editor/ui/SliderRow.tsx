/**
 * One labelled slider: a native range input (keyboard, screen reader and touch
 * support come with it) styled as a filled track, its value, and a reset
 * button that appears once the value leaves neutral.
 *
 * A drag, or a run of key presses while focused, is reported under one gesture
 * key so it undoes as one step.
 */
import { type CSSProperties, useId, useRef } from "react";

export interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  neutral: number;
  format: (value: number) => string;
  description?: string | null;
  /** Why the slider is disabled; enabled when null. */
  disabledReason?: string | null;
  /** A CSS background for the track (e.g. a skin-tone ramp) instead of the fill. */
  track?: string;
  onChange: (value: number, gesture: string) => void;
  onSettle: () => void;
  onFocus?: () => void;
  /** Replaces the reset button's default (set to `neutral`), e.g. to clear an override. */
  onReset?: () => void;
  /** Whether the reset button shows; defaults to the value differing from `neutral`. */
  changed?: boolean;
}

let gestures = 0;

export function SliderRow(p: SliderRowProps) {
  const id = useId();
  const gesture = useRef<string | null>(null);
  const begin = () => {
    gesture.current ??= `${id}:${++gestures}`;
    p.onFocus?.();
  };
  const end = () => {
    if (gesture.current === null) return;
    gesture.current = null;
    p.onSettle();
  };
  const pct = (v: number) => ((v - p.min) / (p.max - p.min)) * 100;
  const from = Math.min(pct(p.neutral), pct(p.value));
  const to = Math.max(pct(p.neutral), pct(p.value));
  const style = {
    "--hk-from": `${from}%`,
    "--hk-to": `${to}%`,
    ...(p.track ? { "--hk-track": p.track } : {}),
  } as CSSProperties;
  const changed = p.changed ?? Math.abs(p.value - p.neutral) > p.step / 2;
  const disabled = Boolean(p.disabledReason);
  const text = p.format(p.value);

  return (
    <div
      className="hk-slider"
      data-disabled={disabled || undefined}
      title={p.description ?? undefined}
    >
      <label className="hk-slider-label" htmlFor={id}>
        {p.label}
      </label>
      <output className="hk-slider-value" htmlFor={id}>
        {text}
      </output>
      <button
        type="button"
        className="hk-icon-button hk-slider-reset"
        aria-label={`Reset ${p.label}`}
        hidden={!changed || disabled}
        onClick={() => {
          if (p.onReset) p.onReset();
          else p.onChange(p.neutral, `${id}:reset:${++gestures}`);
          p.onSettle();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
        </svg>
      </button>
      <input
        id={id}
        className="hk-range"
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        disabled={disabled}
        aria-valuetext={text}
        aria-description={p.disabledReason ?? p.description ?? undefined}
        style={style}
        data-custom-track={p.track ? "" : undefined}
        onPointerDown={begin}
        onFocus={p.onFocus}
        onKeyDown={begin}
        onChange={(e) => {
          begin();
          p.onChange(Number(e.target.value), gesture.current as string);
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onBlur={end}
      />
      {disabled && <p className="hk-slider-note">{p.disabledReason}</p>}
    </div>
  );
}
