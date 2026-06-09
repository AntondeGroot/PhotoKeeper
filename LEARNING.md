# TypeScript & Angular — PhotoKeeper sessions

---

## Session 1 — Shell & tab navigation

===PAGE 1===
How do you read and update an Angular signal?
?
Call it as a function to read: `mySignal()`. Call `.set(newValue)` to update: `mySignal.set('pipeline')`.

---

What problem does a TypeScript union type solve for a fixed set of string values?
?
It restricts the variable to only the allowed values — TypeScript gives a compile error if you assign anything outside the union, e.g. `'review' | 'pipeline' | 'settings'`.

---

How do you conditionally show elements in an Angular template?
?
Use block syntax: `@if (condition) { ... } @else if (condition) { ... } @else { ... }`.

---

How do you conditionally add a CSS class to an element in Angular?
?
Use the class binding: `[class.active]="expression"` — the class is applied when the expression is truthy.

---

How do you call a component method when the user clicks a button in Angular?
?
Use event binding: `(click)="methodName()"` — parentheses on the left name the DOM event, the right side is the expression to run.

===END PAGE===

===PAGE 2===
Why is writing `public` in front of a TypeScript class method redundant?
?
Class members are public by default — adding the keyword changes nothing and breaks consistency with other methods that omit it.

---

What is the conventional order for members inside an Angular component class?
?
Injected dependencies → signals and fields → computed values → lifecycle hooks → public methods → private methods.

---

Why must text content in an Angular template be wrapped in an HTML tag?
?
A bare quoted string like `"some text"` renders the quotes literally as content — wrap it in a `<p>` or other tag to get plain text.

===END PAGE===

---

## Session 2 — Photo interface and mock data

===PAGE 1===
What is a TypeScript interface and what does it guarantee?
?
An interface describes the shape of an object — its field names and types. TypeScript gives a compile error if you create an object that is missing a field or has a field of the wrong type.

---

How do you make a TypeScript interface available in other files?
?
Add `export` in front of it: `export interface Photo { ... }` — then other files can import it by name.

---

How do you type an array of objects in TypeScript?
?
Append `[]` to the type name: `Photo[]` means "an array where every element matches the Photo interface."

---

Why does TypeScript complain about a variable declared without a type annotation?
?
Without an annotation TypeScript tries to infer the type, and if it cannot be certain it falls back to `any` — which disables type checking for that variable. Add an explicit annotation like `: Photo[]` to fix it.

---

What happens if an object literal has a field name that does not match its interface?
?
TypeScript reports an error: the unknown field is flagged and the missing field is also flagged — both problems are caught at the same time.

---

Why use `const` instead of `let` when declaring mock data?
?
`const` means the variable binding cannot be reassigned — you cannot accidentally do `MOCK_PHOTOS = []` later. Use `const` by default and only reach for `let` when you specifically need to reassign the variable. `var` is old JavaScript — never use it in TypeScript.

---

What is the naming convention for a module-level constant array of mock data, and why?
?
Use UPPER_SNAKE_CASE, e.g. `MOCK_PHOTOS` — all-caps signals "this is a fixed, module-level constant that never changes." The prefix `MOCK_` is an adjective modifier ("mock photos"); past-tense forms like `MOCKED_` are non-idiomatic. The noun should match the contents: `PHOTOS` for an array of photos.

---

When is a typed mock data constant useful beyond just building the UI?
?
The same exported constant can be imported directly in unit tests as controlled, predictable input — no need to spin up a database or API, and the TypeScript interface guarantees the test data has the right shape.

===END PAGE===

---

## Session 3 — Importing data and displaying it in the template

===PAGE 1===
How do you import a value from another TypeScript file in the same folder?
?
Use `import { ThingToImport } from './filename'` — the `./` means "same folder," and you omit the `.ts` extension.

---

How do you import multiple exports from the same file?
?
List them separated by commas inside the curly braces: `import { Photo, MOCK_PHOTOS } from './photo'`.

---

When should a class property be `readonly` instead of a signal?
?
Use `readonly` for data that never changes after the class is created — static constants, injected config, mock data. Signals are for values that change over time and need to trigger re-renders.

---

How do you render a value from the component class as text in an Angular template?
?
Wrap it in double curly braces: `{{ myProperty }}` — Angular evaluates the expression and renders it as text.

---

How do you provide a fallback value in a template interpolation when a field might be null?
?
Use the `||` operator inside the braces: `{{ photo.album || 'No album' }}` — if `album` is null or empty the fallback string is rendered instead.

===END PAGE===

---

## Session 4 — Navigation with computed and index signals

===PAGE 1===
What is a `computed` in Angular and when should you use it instead of a signal?
?
A `computed` derives its value from one or more signals and recalculates automatically when they change. Use it when a value can always be calculated from existing state — e.g. the current photo is always `photos[index]`, so it is a computed, not a separate signal.

---

What return type should a navigation method have, and why?
?
`void` — navigation methods change state as a side effect and return nothing useful to the caller. Returning the new value implies the caller needs it, which is misleading when the template ignores the return value entirely.

---

Why should all `computed` values be grouped together in the class?
?
A reader scanning the class top-to-bottom builds a mental model of what is state (signals) and what is derived (computed). Splitting computed values across the class breaks that model and makes the file harder to reason about.

---

How do you guard against an out-of-bounds array access in an Angular template?
?
Wrap the content in `@if (myComputed())` — if the computed returns `undefined` (index out of range) the block is hidden, preventing a runtime error.

===END PAGE===