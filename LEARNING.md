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

---

## Session 8 — Array methods and comparison operators

===PAGE 1===
What is the difference between `==` and `===` in TypeScript?
?
`===` (strict equality) checks both value and type — `1 === '1'` is false. `==` (loose equality) coerces types before comparing — `1 == '1'` is true. Always use `===` in TypeScript; loose equality leads to subtle bugs and is flagged by the ESLint `eqeqeq` rule in this project.

---

How do you check whether every item in an array passes a condition?
?
Use `Array.every()` — it returns `true` if all items pass the test, `false` as soon as one fails: `photos.every(p => p.status !== 'backlog')`.

---

How do you count items in an array that match a condition?
?
Chain `Array.filter()` and `.length` — `filter()` returns a new array of matching items, `.length` gives the count: `photos.filter(p => p.status === 'kept').length`.

===END PAGE===

---

## Session 9 — Style binding and progress tracking

===PAGE 1===
How do you bind a CSS property value directly from the component in Angular?
?
Use the style binding syntax: `[style.width.%]="expression"` — the property name goes after `style.`, the optional unit after a second dot. If `expression` returns `60`, the element gets `width: 60%`.

---

How do you clamp a computed number to a maximum value?
?
Use `Math.min(max, value)` — `Math.min(100, percent)` ensures the result never exceeds 100 regardless of the input.


===END PAGE===

---

## Session 10 — Outputs, pointer events, and template literals

===PAGE 1===
How does a child component send an event back up to the parent?
?
Decorate a property with `@Output()` and assign it a `new EventEmitter<T>()`. Call `.emit(value)` inside the class to fire the event. The parent listens with `(eventName)="method($event)"` in its template. `@Output` and `EventEmitter` must both be imported from `@angular/core`.

---

What is the difference between `@Input()` and `@Output()`?
?
`@Input()` passes data *into* a child — the parent sets it. `@Output()` sends events *out* of a child — the child fires them with `.emit()` and the parent reacts. They are the two directions of parent-child communication in Angular.

---

Does calling `.emit()` stop execution of the current method?
?
No. `.emit()` dispatches the event and returns — execution continues on the next line, just like any other method call. Only `return` stops the function. This is why a single `if / else if` chain is needed when emitting verdicts: without `else if`, a diagonal drag could fall through and emit twice.

---

How do you build a string that contains live values in TypeScript?
?
Use a template literal — backticks instead of quotes, with `${}` to embed expressions:
```typescript
`translate(${this.dragX()}px, ${this.dragY()}px)`
```
The result is a regular string with the current values substituted in. Useful for CSS `transform` values and any string that needs computed parts.

---

What are pointer events and why use them instead of mouse or touch events?
?
`pointerdown`, `pointermove`, `pointerup`, and `pointercancel` are unified events that fire for mouse, touch, and stylus input. Using them means one set of handlers works on desktop and mobile. `pointercancel` fires when the OS interrupts the gesture (e.g. an incoming call) — always handle it the same as `pointerup` so the card does not get stuck mid-drag.

---

What does `setPointerCapture` do and why is it needed for drag?
?
`(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)` tells the browser to keep sending pointer events to this element even if the pointer moves outside it. Without it, moving the finger outside the card boundary stops firing `pointermove` and the drag freezes.

---

What does `touch-action: none` do in CSS?
?
It tells the browser not to handle touch gestures (scroll, zoom) on that element, so pointer events are delivered to your code instead. Without it the browser may intercept a swipe gesture and scroll the page rather than firing `pointermove`.

---

How do you toggle a CSS class on an element based on a signal?
?
Use `[class.dragging]="dragging()"` — Angular adds the class when the signal is `true` and removes it when it is `false`. Useful for toggling styles like `transition: none` during an active drag so the card tracks the finger instantly instead of lagging.

===END PAGE===

---

## Session 11 — Optional fields, nested interfaces, and @if aliasing

===PAGE 1===
What does `?` after a field name in a TypeScript interface mean?
?
The field is optional — it may or may not be present on the object. TypeScript will not complain if you leave it out when creating an object, and the field's type becomes `T | undefined`.
```typescript
export interface Photo {
  ai?: AiHint; // fine to omit entirely
}
```

---

What is a nested interface and when should you use one?
?
A nested interface is a separate interface used as the type of a field on another interface. Use it when a field holds a structured object with its own named fields rather than a primitive value:
```typescript
export interface AiHint {
  verdict: 'kept' | 'rejected' | 'toEdit';
  reason: string;
}
export interface Photo {
  ai?: AiHint;
}
```
Both interfaces should be exported so they can be imported and used in other files.

---

How do you capture the value of an `@if` condition into a local variable?
?
Use the `; as` syntax — the truthy value is assigned to the named variable and available inside the block:
```html
@if (currentReviewPhoto().ai; as hint) {
  {{ hint.verdict }} · {{ hint.reason }}
}
```
Without `; as`, you would have to repeat the full expression and add `!` to tell TypeScript the value is non-null, because it cannot see inside the `@if` guard:
```html
{{ currentReviewPhoto().ai!.verdict }}
```
With `; as hint`, TypeScript already knows `hint` is the narrowed non-null value, so no `!` is needed.

---

What does Angular error NG8107 mean?
?
"The left side of this optional chain operation does not include null or undefined in its type — replace `?.` with `.`." Angular's strict template checker knows the value cannot be null or undefined at that point, so the `?.` is unnecessary and should be removed.

===END PAGE===

---

## Session 12 — `as const`

===PAGE 1===
What does `as const` do and when do you need it?
?
`as const` tells TypeScript to treat a value as its narrowest possible literal type instead of widening it. For string literals in object literals TypeScript usually infers the literal type already, but `as const` makes the intent explicit and prevents widening in cases where TypeScript might otherwise infer `string`:
```typescript
{ ...item, status: 'toPrint' as const }
```
Without `as const` TypeScript might infer `status: string`, which would not be assignable to a union like `'kept' | 'rejected' | 'toPrint'`. With it, the type is locked to `'toPrint'` and the assignment is accepted.

===END PAGE===

---

## Session 16 — Nested loops, grouping data, and component wiring

===PAGE 1===
What is the correct syntax for `@for` in Angular, including the `track` clause?
?
`track` goes at the end after a semicolon:
```html
@for (item of items; track item.id) {
  ...
}
```

---


---

Is `track` required in Angular's `@for`, and what value should you pass?
?
Yes, `track` is always required — Angular gives a compile error without it. The value tells Angular how to identify each item so it can update the DOM efficiently when the list changes:
- Object with a unique field → `track item.id` (preferred)
- Plain string or number → `track item` (the value itself is the identity)
- No unique field → `track $index` (loop index, works but less efficient)

Avoid `track item` for objects. If Angular re-creates the array (e.g. from `.map()`), every object is a new reference even if the data is the same — Angular can't tell they're the same item and rebuilds every DOM element unnecessarily. `track item.id` tracks by value, so unchanged items are skipped.

---

How do you write nested `@for` loops in Angular?
?
Put one `@for` block inside the body of another. Use distinct variable names for each level:
```html
@for (group of albumGroups; track group.album) {
  <h4>{{ group.album }}</h4>
  @for (photo of group.photos; track photo.id) {
    <div>{{ photo.name }}</div>
  }
}
```

---

What is the difference between `AlbumGroup` and `AlbumGroup[]` as an `@Input()` type?
?
`AlbumGroup` is a single object with one album and its photos. `AlbumGroup[]` is an array of those objects — one entry per album. A component that receives multiple albums needs `AlbumGroup[]`:
```typescript
@Input() toEditByAlbum: AlbumGroup[] = [];
```
Omitting `[]` means the input expects only a single album group, which would be the wrong shape.

---


===END PAGE===