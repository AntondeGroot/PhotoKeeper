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

---

## Session 5 — Standalone components and @Input()

===PAGE 1===
What is an Angular component and why split UI into multiple components?
?
A component is a self-contained piece of UI with its own TypeScript class, template, and styles. Splitting into components keeps each file small and focused — a single large component becomes unmanageable as the app grows.

---

What is the difference between a TypeScript `import` and Angular's `imports: []` array?
?
A TypeScript `import` at the top of the file makes a symbol available to use in that file. Angular's `imports: []` inside `@Component` tells Angular which other *components* the template needs to render — TypeScript interfaces and constants never go there.

---

How do you pass data from a parent component into a child component?
?
Decorate a property in the child class with `@Input()`, then bind to it from the parent template with `[propertyName]="value"`. The `@Input()` decorator must be imported from `@angular/core`.

---

What does `!` after a property declaration mean in TypeScript?
?
The non-null assertion `photo!: Photo` tells TypeScript "I guarantee this will be assigned before it is used." Use it on required `@Input()` properties that have no default value but are always provided by the parent.

---

How do you make a component available to use in another component's template?
?
Add it to the `imports: []` array in the parent's `@Component` decorator, and import the class at the top of the parent's TypeScript file.

---

What does a complete minimal Angular component with an `@Input()` look like?
?
```typescript
import { Component, Input } from '@angular/core';
import { Photo } from '../photo';

@Component({
  selector: 'app-photo-card',
  templateUrl: './photo-card.html',
  imports: [],
})
export class PhotoCardComponent {
  @Input() photo!: Photo;
}
```
The `@Component` decorator configures the component; the class body holds its inputs and logic.

===END PAGE===

---

## Session 6 & 7 — Signals as mutable state, updating arrays, and the spread operator

===PAGE 1===
What is the difference between `signal.set()` and `signal.update()`?
?
`.set(value)` replaces the signal's value entirely. `.update(fn)` gives you the current value and replaces it with whatever the function returns — useful when the new value depends on the old one.

---

How do you update one item inside an array signal without mutating it?
?
Use `.update()` with `Array.map()` — return a new array where the matching item is replaced and all others pass through unchanged:
```typescript
this.items.update(list =>
  list.map(item => item.id === targetId ? { ...item, status: 'done' } : item)
);
```

---

What does the spread operator `{ ...obj, field: value }` do?
?
It creates a new object with all fields copied from `obj`, then overrides the specified field. The original object is not mutated — this is the standard pattern for updating one field on an immutable object.

---

Why should a local variable not share a name with a class property?
?
A local variable shadows the class property within that scope — a reader cannot tell which one is meant without checking both. Use a distinct name for the local variable to make the intent clear.

---

What is a TypeScript `type` alias and when is it useful?
?
`type MyVerdict = 'kept' | 'rejected' | 'toEdit'` gives a name to a union type so it can be reused. Use it when the same union appears in multiple places.

---

How do you read the "update one item in an array signal" pattern line by line?
?
```typescript
this.reviewPhotos.update((list) =>    // give me the current array, I'll return a new one
  list.map((item) =>                  // go through every photo one by one
    item.id === current.id            // is this the photo we decided on?
      ? { ...item, status: verdict }  // yes → copy it with the new status
      : item                          // no → return it unchanged
  )
);
```
You cannot change an item inside a signal's array directly — instead you replace the whole array with a new one where one item is different. `.map()` produces that new array.

===END PAGE===