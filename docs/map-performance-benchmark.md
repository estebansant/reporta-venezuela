# Map Performance Benchmark Plan

Use this protocol before raising `MAP_PAGE_SIZE` again or adding clustering/WebGL.

## Variants

- React-Leaflet DOM markers as the baseline.
- Current Leaflet + Canvas layer.
- Canvas with cached projections and spatial hit testing.
- Clustered points at low zoom.
- WebGL point layer, only if Canvas/clustering misses the target.

## Datasets

Measure with 500, 2,500, 10,000, and 50,000 synthetic points spread across the same viewport. Include a dense-city case where most points overlap in Caracas/La Guaira.

## Metrics

- First point render time after API data arrives.
- Pan/zoom frame rate for a 10 second continuous drag.
- Click hit-test latency on dense points.
- JS heap after initial render and after 10 pan cycles.
- Client bundle size added by the variant.

## Decision Rule

Keep the simplest implementation that sustains smooth pan/zoom with 2,500 visible points. Add clustering when density makes individual points unreadable. Add WebGL only if measured interaction is clearly better than Canvas/clustering and the bundle cost is acceptable.
