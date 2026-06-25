"use client";

import { useState } from "react";
import { CitySelect, StateSelect } from "react-country-state-city";

import {
  normalizeVenezuelanCity,
  normalizeVenezuelanState,
} from "@/lib/venezuelan-locations";

const VENEZUELA_COUNTRY_ID = 239;

export function ReportLocationFields({
  resetKey,
  onStateChange,
  onCityChange,
}: {
  resetKey: number;
  onStateChange: (state: string) => void;
  onCityChange: (city: string) => void;
}) {
  const [selectedStateId, setSelectedStateId] = useState(0);
  const [cityFieldKey, setCityFieldKey] = useState(0);

  function resetCity() {
    onCityChange("");
    setCityFieldKey((current) => current + 1);
  }

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
      </label>
      <label>
        <span>Ciudad *</span>
        <CitySelect
          key={`city-${selectedStateId}-${cityFieldKey}-${resetKey}`}
          countryid={VENEZUELA_COUNTRY_ID}
          stateid={selectedStateId}
          containerClassName="country-location-field"
          inputClassName="country-location-input"
          placeHolder={
            selectedStateId
              ? "Selecciona o escribe una ciudad"
              : "Escribe la ciudad"
          }
          autoComplete="address-level2"
          onChange={(city) => {
            if ("name" in city) {
              onCityChange(normalizeVenezuelanCity(city.name));
            }
          }}
          onTextChange={(event) => onCityChange(event.target.value)}
        />
      </label>
    </>
  );
}
