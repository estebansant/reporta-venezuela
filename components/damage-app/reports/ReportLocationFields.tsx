"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { GetCity, GetState, StateSelect } from "react-country-state-city";

import { Input } from "@/components/ui/input";
import {
  normalizeVenezuelanCity,
  normalizeVenezuelanState,
} from "@/lib/venezuelan-locations";

const VENEZUELA_COUNTRY_ID = 239;
const LA_GUAIRA_STATE = "La Guaira";
const MACUTO_CITY = "Macuto";

export function ReportLocationFields({
  resetKey,
  stateValue,
  cityValue,
  onStateChange,
  onCityChange,
  stateError,
  cityError,
}: {
  resetKey: number;
  stateValue: string;
  cityValue: string;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
  stateError?: string;
  cityError?: string;
}) {
  const [selectedStateId, setSelectedStateId] = useState(0);
  const [citySuggestions, setCitySuggestions] = useState<string[]>([]);
  const citySuggestionsId = useId();

  useEffect(() => {
    if (!stateValue) return;

    let active = true;
    GetState(VENEZUELA_COUNTRY_ID).then((states) => {
      if (!active) return;
      const normalizedState = normalizeVenezuelanState(stateValue);
      const restoredState = states.find(
        (state) => normalizeVenezuelanState(state.name) === normalizedState,
      );
      setSelectedStateId(restoredState?.id ?? 0);
    });

    return () => {
      active = false;
    };
  }, [stateValue]);

  useEffect(() => {
    let active = true;

    if (!selectedStateId) {
      setCitySuggestions(
        normalizeVenezuelanState(stateValue) === LA_GUAIRA_STATE
          ? [MACUTO_CITY]
          : [],
      );
      return () => {
        active = false;
      };
    }

    GetCity(VENEZUELA_COUNTRY_ID, selectedStateId).then((cities) => {
      if (!active) return;
      const normalizedState = normalizeVenezuelanState(stateValue);
      const suggestions = new Set(
        cities.map((city) => normalizeVenezuelanCity(city.name)),
      );
      if (normalizedState === LA_GUAIRA_STATE) {
        suggestions.add(MACUTO_CITY);
      }
      setCitySuggestions(
        Array.from(suggestions).sort((first, second) =>
          first.localeCompare(second, "es-VE"),
        ),
      );
    });

    return () => {
      active = false;
    };
  }, [selectedStateId, stateValue]);

  function resetCity() {
    onCityChange("");
  }

  const stateErrorId = stateError ? `report-state-error-${resetKey}` : undefined;
  const cityErrorId = cityError ? `report-city-error-${resetKey}` : undefined;
  const cityPlaceholder = useMemo(
    () =>
      selectedStateId || normalizeVenezuelanState(stateValue) === LA_GUAIRA_STATE
        ? "Selecciona o escribe una ciudad o zona"
        : "Escribe la ciudad o la zona",
    [selectedStateId, stateValue],
  );

  return (
    <>
      <label>
        <span>Estado *</span>
        <StateSelect
          key={`state-${resetKey}`}
          countryid={VENEZUELA_COUNTRY_ID}
          containerClassName="country-location-field"
          inputClassName="country-location-input"
          placeHolder="Selecciona o escribe un estado"
          autoComplete="address-level1"
          defaultValue={stateValue as never}
          aria-invalid={stateError ? true : undefined}
          aria-describedby={stateErrorId}
          onChange={(state) => {
            if (!("id" in state) || !("name" in state)) return;
            setSelectedStateId(state.id);
            onStateChange(normalizeVenezuelanState(state.name));
            resetCity();
          }}
          onTextChange={(event) => {
            setSelectedStateId(0);
            onStateChange(event.target.value);
            resetCity();
          }}
        />
        {stateError ? (
          <p className="field-help field-error" id={stateErrorId}>
            {stateError}
          </p>
        ) : null}
      </label>
      <label>
        <span>Ciudad *</span>
        <Input
          className="country-location-input"
          list={citySuggestions.length ? citySuggestionsId : undefined}
          value={cityValue}
          placeholder={cityPlaceholder}
          autoComplete="address-level2"
          aria-invalid={cityError ? true : undefined}
          aria-describedby={cityErrorId}
          onChange={(event) => onCityChange(event.target.value)}
        />
        {citySuggestions.length ? (
          <datalist id={citySuggestionsId}>
            {citySuggestions.map((city) => (
              <option key={city} value={city} />
            ))}
          </datalist>
        ) : null}
        {cityError ? (
          <p className="field-help field-error" id={cityErrorId}>
            {cityError}
          </p>
        ) : null}
      </label>
    </>
  );
}
