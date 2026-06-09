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