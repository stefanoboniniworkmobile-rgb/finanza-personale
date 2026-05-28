"use client";

import { forwardRef, useEffect, useState } from "react";
import { fmtForInput, parseItalianNumber } from "@/lib/format";

/**
 * Input numerico in formato italiano:
 * - separatore migliaia "."
 * - separatore decimale ","
 * - on-init e on-blur: il valore mostrato viene riformattato dalla libreria Intl
 * - durante la digitazione: l'utente vede ciò che digita (no battaglie con il caret)
 * - on-blur: il valore numerico parsato (numero o null) viene notificato via onValueChange
 *
 * Internamente usa <input type="text" inputMode="decimal"> per evitare i limiti
 * dei type="number" del browser (che non mostrano mai il separatore migliaia).
 *
 * Compatibile con form: scrive `value` come stringa nel DOM se passi `name`.
 */
export type NumberInputProps = {
  value: number | null;
  onValueChange?: (v: number | null) => void;
  /** Mostra "0" anziché stringa vuota quando v=0. */
  keepZero?: boolean;
  /** Numero di decimali da mostrare (max). Default 2 (per importi €). */
  maxDecimals?: number;
  /** Hidden input name per submit form. */
  name?: string;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  min?: number;
  max?: number;
  /** Callback su Invio. */
  onEnter?: () => void;
  /** Selezione tutto al focus. Default true. */
  selectOnFocus?: boolean;
  /** Riferimento al raw input. */
  inputRef?: React.Ref<HTMLInputElement>;
  /** Pass-through ARIA. */
  "aria-label"?: string;
};

export const NumberInput = forwardRef<HTMLInputElement, NumberInputProps>(
  function NumberInput(
    {
      value,
      onValueChange,
      keepZero = false,
      maxDecimals = 2,
      name,
      className,
      placeholder,
      disabled,
      required,
      min,
      max,
      onEnter,
      selectOnFocus = true,
      inputRef,
    },
    _ref,
  ) {
    // Formattatore locale che rispetta `maxDecimals`
    const fmt = (n: number) => {
      if (!Number.isFinite(n)) return "";
      if (n === 0 && !keepZero) return "";
      const hasDec = !Number.isInteger(n);
      return new Intl.NumberFormat("it-IT", {
        minimumFractionDigits: hasDec ? Math.min(2, maxDecimals) : 0,
        maximumFractionDigits: maxDecimals,
      }).format(n);
    };

    const [text, setText] = useState<string>(() =>
      value === null || value === undefined ? "" : fmt(value),
    );
    const [focused, setFocused] = useState(false);

    // Sincronizzo con value in arrivo dall'esterno solo se l'input non è in editing
    useEffect(() => {
      if (focused) return;
      const expected = value === null || value === undefined ? "" : fmt(value);
      setText(expected);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, focused]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      // Permetto solo cifre, "." (sep. migliaia), "," (decimale), spazi e "-"
      const cleaned = e.target.value.replace(/[^0-9.,\-\s€]/g, "");
      setText(cleaned);
    };

    const commit = () => {
      const parsed = parseItalianNumber(text);
      if (parsed === null) {
        setText(value === null || value === undefined ? "" : fmt(value));
        return;
      }
      let v = parsed;
      if (typeof min === "number") v = Math.max(min, v);
      if (typeof max === "number") v = Math.min(max, v);
      // Riformatto il display
      setText(fmt(v));
      if (onValueChange && v !== value) onValueChange(v);
    };

    const handleBlur = () => {
      setFocused(false);
      commit();
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
      setFocused(true);
      if (selectOnFocus) e.target.select();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commit();
        onEnter?.();
      }
    };

    return (
      <>
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          className={className}
          placeholder={placeholder}
          disabled={disabled}
          required={required}
        />
        {name && (
          <input
            type="hidden"
            name={name}
            value={parseItalianNumber(text) ?? ""}
            readOnly
          />
        )}
      </>
    );
  },
);

/** Helper se serve formattare/parsare al di fuori. */
export { fmtForInput, parseItalianNumber };
