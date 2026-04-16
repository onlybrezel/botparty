# ADR-003: Pydantic for robot client configuration

**Date:** 2024  
**Status:** Accepted

## Context

The Python robot client (`botparty-client`) loads its configuration from a YAML file. Configuration validation is needed to give clear error messages when required fields are missing or have wrong types.

## Decision

Use Pydantic v2 models (`BaseModel`) for all configuration parsing.

## Rationale

- **Validation depth:** Pydantic validates nested structures and produces clear, field-level error messages out of the box — far superior to manual `dict.get()` chains with `isinstance()` checks.
- **Type coercion:** Pydantic coerces compatible types (e.g. int → float, string → enum) automatically, making configuration files more forgiving.
- **IDE support:** Pydantic models are fully recognized by mypy and Pylance — configuration field access is type-checked throughout the codebase.
- **Serialization:** `model.model_dump()` makes it easy to log or transmit the active configuration for diagnostics.
- **Dataclass alternative:** Python dataclasses would require a separate validation library (e.g. `cattrs`) to achieve the same result and lack Pydantic's ecosystem of custom validators and JSON schema generation.

## Consequences

- `pydantic>=2.0` is a required dependency. Pydantic v1 has a different API and is not supported.
- Complex hardware option types (lists of pin numbers, optional floats) require custom validator methods.
