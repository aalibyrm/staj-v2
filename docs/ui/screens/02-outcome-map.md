# Screen Brief: Outcome Map

- `ui-key`: `outcome-map`
- Route: `/outcomes/map`
- Primary roles: instructor, program owner, administrator
- Reference: `docs/ui/reference/02-outcome-map.webp`
- Primary phase: 02

## Purpose

Kazanımları, önkoşul/destekleyici ilişkileri ve yetkinlik durumlarını filtrelenebilir graph ve erişilebilir alternatif liste olarak gösterir.

## Required regions

- Grade/course/search/mastery filters
- Legend with text + icon/pattern
- Zoom, fit, focus and selected-node graph controls
- Unique-coded outcome nodes and directional relations
- Selected outcome inspector: description, mastery, prerequisites, dependents, affected count, recommended content
- Risky nodes table/list
- Alternative accessible list/table view

## Required behavior

Graph data facade/store'dan gelir. Cycle rule save/publish sırasında engel olur. Hundreds-of-nodes dataset için lazy render/focus/filter ölçülür.

## Responsive

Tablet inspector overlay drawer olur. Mobile graph yerine varsayılan list view sunulabilir; graph ayrı tam ekran açılır.

## Prohibitions

- Referanstaki tekrar eden outcome kodları kopyalanmaz.
- Bağlantılar statik SVG dekorasyonu olmaz.
- Renk tek başına mastery seviyesi anlatmaz.
