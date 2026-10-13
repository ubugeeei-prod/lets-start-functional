---
title: Parser Combinators
description: Build a parser-combinator library from scratch and earn Functor, Applicative, Monad and Alternative on one concrete type.
---

# Parser Combinators

Users write regexes as strings (`(colou?r|gr[ae]y)`), and we need to turn those strings into trees. Instead of writing one big parser, we build a small library of parser *pieces*, and in the process finally earn the interfaces with the scary names.

## A parser is just a function

Strip away everything and ask: what does a parser *do*? It takes input characters. It either fails, or it produces a value, and, crucially, the input it did not consume, so the next parser can pick up where it left off. In types:

```idris
||| A parser of `a`s: consume characters, maybe produce an `a`
||| and the unconsumed rest.
public export
record Parser a where
  constructor MkParser
  runParser : List Char -> Maybe (a, List Char)
```

That is the whole secret. A `Parser Char` is a function `List Char -> Maybe (Char, List Char)`: not an object with state, not a generated table, just a function wrapped in a record so we can hang implementations on it.

The plan for this chapter is what makes combinators famous: we will write a few *tiny* parsers (one character, satisfying a predicate), and then get sequencing, choice and repetition, the entire grammar toolkit, by implementing four standard interfaces for `Parser`. If words like `Functor` and `Monad` have chased you away from functional programming before, this is the chapter where they stop being words and start being four short blocks of code about leftover input.

## Red: specs that demand the interfaces

`regex/tests/src/Spec/Parse.idr`, verbatim:

```idris
||| Specs for `Regex.Parse` — a parser-combinator library from scratch.
|||
||| A `Parser a` is just a function from input to "maybe a result and
||| the leftover input". Everything else — sequencing, choice,
||| repetition — falls out of implementing the standard interfaces.
module Spec.Parse

import Harness
import Regex.Parse

export
parseSpecs : List Spec
parseSpecs =
  [ shouldBe "char consumes exactly its character"
      (parse (char 'a') "a") (Just 'a')
  , shouldBe "char rejects the wrong character"
      (parse (char 'a') "b") Nothing
  , shouldBe "parse demands that all input is consumed"
      (parse (char 'a') "ab") Nothing
  , shouldBe "map transforms a result (Functor)"
      (parse (map toUpper (char 'a')) "a") (Just 'A')
  , shouldBe "sequencing keeps both results (Applicative)"
      (parse [| MkPair (char 'a') (char 'b') |] "ab") (Just ('a', 'b'))
  , shouldBe "choice takes the first branch that succeeds (Alternative)"
      (parse (char 'a' <|> char 'b') "b") (Just 'b')
  , shouldBe "many matches zero occurrences"
      (parse (many (satisfy isDigit)) "") (Just [])
  , shouldBe "many matches as many occurrences as it can"
      (parse (many (satisfy isDigit)) "123") (Just ['1', '2', '3'])
  , shouldBe "some demands at least one occurrence"
      (parse (some (satisfy isDigit)) "") Nothing
  , shouldBe "natural reads a number (Monad, do-notation inside)"
      (parse natural "2026") (Just 2026)
  , shouldBe "combinators compose: a natural between parentheses"
      (parse (char '(' *> natural <* char ')') "(42)") (Just 42)
  ]
```

Read the list as a wish list, one interface per wish:

- The first three want the primitives: `char`, and a `parse` that treats leftover input as failure.
- "map transforms a result" wants **Functor**: run a parser, then apply a function to what it produced.
- "sequencing keeps both results" wants **Applicative**: run two parsers one after another, feeding the leftovers of the first into the second. (`[| MkPair p q |]` is new syntax; we will get there.)
- "choice takes the first branch that succeeds" wants **Alternative** and its operator `<|>`.
- `many` and `some` want repetition: zero-or-more and one-or-more, the `*` and `+` of the parsing world.
- `natural` wants **Monad**: several parsing steps glued with `do`, where later steps see earlier results.
- The last spec is the payoff: `char '(' *> natural <* char ')'` reads almost like the grammar it parses. `*>` and `<*` mean "sequence, keep the result the arrow points at"; both come free with Applicative.

```sh
make test
```

```
Error: Module Regex.Parse not found

Spec.Parse:9:1--9:19
 5 | ||| repetition — falls out of implementing the standard interfaces.
 6 | module Spec.Parse
 7 |
 8 | import Harness
 9 | import Regex.Parse
     ^^^^^^^^^^^^^^^^^^
```

Red. This is commit [2f2adb1](https://github.com/ubugeeei-prod/lets-start-functional/commit/2f2adb1c70dceb08238d9831b5be61e722d046ce).

## Green: the primitives

`regex/src/Regex/Parse.idr` begins with the record you have already seen, then the runner:

```idris
||| Run a parser against a whole string. Succeeds only when every
||| character is consumed — leftovers mean the parse failed.
public export
parse : Parser a -> String -> Maybe a
parse p s =
  case runParser p (unpack s) of
    Just (a, []) => Just a
    _            => Nothing
```

The pattern `Just (a, [])` is doing the policing: a result *and* an empty leftover list, or no deal. This is why `parse (char 'a') "ab"` is `Nothing`: the `'b'` was never consumed, and trailing garbage is a failed parse, not a shrug.

Two primitive parsers are all we will ever hand-write:

```idris
||| Consume one character satisfying the predicate.
public export
satisfy : (Char -> Bool) -> Parser Char
satisfy ok = MkParser $ \cs =>
  case cs of
    (c :: rest) => if ok c then Just (c, rest) else Nothing
    []          => Nothing

||| Consume exactly the character `c`.
public export
char : Char -> Parser Char
char c = satisfy (== c)
```

Everything else in this chapter (and the entire pattern parser in the next) is built by *combining* these. Hence the name.

## The interface ladder

Now the four implementations, in order of increasing power. For each: the code, and the one thing it buys us in the specs.

### Functor: transform the result

```idris
public export
Functor Parser where
  map f p = MkParser $ \cs =>
    case runParser p cs of
      Just (a, rest) => Just (f a, rest)
      Nothing        => Nothing
```

Run `p`; if it succeeded, apply `f` to the value and leave the leftovers alone. That is all `Functor` means: this type has a `map`. Lists have one, `Maybe` has one, and now parsers have one, which is what lets the spec write `map toUpper (char 'a')` and get a parser of uppercase letters without new machinery.

### Applicative: sequencing

```idris
public export
Applicative Parser where
  pure a = MkParser $ \cs => Just (a, cs)
  pf <*> pa = MkParser $ \cs =>
    case runParser pf cs of
      Nothing        => Nothing
      Just (f, rest) =>
        case runParser pa rest of
          Nothing         => Nothing
          Just (a, rest') => Just (f a, rest')
```

Two pieces. `pure a` is the parser that consumes nothing and succeeds with `a` (you will be surprised how often that is useful). `<*>` is sequencing: run the first parser, *thread its leftover input into the second*, and apply the first's result (a function) to the second's. That threading of `rest` is the entire discipline of parsing made explicit. No global cursor, no mutable position, just a value passed along.

This is what the spec's odd-looking `[| MkPair (char 'a') (char 'b') |]` needed. The `[| ... |]` are **idiom brackets**, Idris sugar for Applicative sequencing: `[| f p q |]` means `pure f <*> p <*> q`, that is, run `p`, then `q`, then combine their results with `f`. With `MkPair` as the `f`, we parse an `'a'` then a `'b'` and keep both. And once Applicative exists, the standard library throws in `*>` and `<*` (sequence, discard one side) for free; the last spec's parenthesized natural is powered entirely by this block.

### Monad: the next parser can depend on the last result

```idris
public export
Monad Parser where
  p >>= f = MkParser $ \cs =>
    case runParser p cs of
      Nothing        => Nothing
      Just (a, rest) => runParser (f a) rest
```

Look at the type of the second argument: `f` is a *function that returns a parser*. Applicative runs a fixed pipeline of parsers decided in advance; Monad lets the result of one parse **choose** what to parse next. That is strictly more power, and it is exactly the shape `do`-notation desugars to: every `x <- p` line in a `do` block is a `>>=`. We will lean on this hard in the [next chapter](./14-pattern-syntax.md), where what follows a `{` depends on what we find inside it.

### Alternative: try this, else that

```idris
public export
Alternative Parser where
  empty = MkParser $ \_ => Nothing
  p <|> q = MkParser $ \cs =>
    case runParser p cs of
      Just res => Just res
      Nothing  => runParser q cs
```

`empty` is the parser that always fails. `<|>` tries `p`, and if it fails, tries `q`, on the *original* input `cs`, not on whatever `p` half-consumed before dying. Our parsers backtrack fully at every choice point, which keeps the semantics dead simple: a failed branch never leaves footprints. This buys the spec its `char 'a' <|> char 'b'`, and buys the next chapter its grammar alternatives.

> [!NOTE]
> If you know Haskell: you have just watched Parsec's great-grandparent being born. Industrial combinator libraries add error messages, streaming and performance tricks, but the four instances above are the same four they are built on, in about a hundred lines.

## Repetition, and a confession

```idris
mutual
  ||| Zero or more occurrences. (`many p` can call itself forever if
  ||| `p` succeeds without consuming, so Idris will not certify it
  ||| total — we own up to that with `covering`.)
  public export
  covering
  many : Parser a -> Parser (List a)
  many p = some p <|> pure []

  ||| One or more occurrences. The idiom brackets `[| ... |]` are
  ||| Applicative sugar: cons the first result onto the rest.
  public export
  covering
  some : Parser a -> Parser (List a)
  some p = [| p :: many p |]
```

Two definitions that lean on each other: *one or more* is one, then zero or more; *zero or more* is one-or-more, or else the empty list. `[| p :: many p |]` is idiom brackets again: parse one `p`, parse the rest, cons them together.

Now the confession. These functions are marked `covering`, not `total`, and Idris made us write that. Here is why: `many p` only terminates if `p` consumes input every time it succeeds. Feed it a parser that succeeds *without* consuming (`pure ()`, say) and `many (pure ())` will loop forever, always succeeding, never advancing. Idris's totality checker cannot rule that out from the types we have given it, so it refuses to stamp `total`, and `covering` is us admitting it aloud: "all cases are handled, but termination is on us." Every parser we actually feed to `many` consumes at least one character, so we are safe in practice. But the honesty is in the source, where the reader can see it, rather than in a comment nobody checks. (It is possible to make combinator parsing fully `total` by tracking input consumption in the types; that is a beautiful rabbit hole and firmly outside this book.)

Finally, the spec that demanded Monad:

```idris
||| Parse a natural number, digit by digit.
public export
covering
natural : Parser Nat
natural = map digitsToNat (some (satisfy isDigit))
  where
    digitVal : Char -> Nat
    digitVal c = cast (ord c - ord '0')

    digitsToNat : List Char -> Nat
    digitsToNat = foldl (\acc, c => 10 * acc + digitVal c) 0
```

`some (satisfy isDigit)` collects the digit characters; `digitsToNat` folds them into a number the way you learned in school (multiply the accumulator by ten, add the digit), which is precisely a left fold, because place value depends on reading left to right.

```sh
make test
```

```
  ...
  ok    char consumes exactly its character
  ok    char rejects the wrong character
  ok    parse demands that all input is consumed
  ok    map transforms a result (Functor)
  ok    sequencing keeps both results (Applicative)
  ok    choice takes the first branch that succeeds (Alternative)
  ok    many matches zero occurrences
  ok    many matches as many occurrences as it can
  ok    some demands at least one occurrence
  ok    natural reads a number (Monad, do-notation inside)
  ok    combinators compose: a natural between parentheses
98/98 passed
```

This is commit [f42babe](https://github.com/ubugeeei-prod/lets-start-functional/commit/f42babe98d53628594789591671542e4fca2419b).

## What the language just did for us

The scary names turned out to be a ladder of capabilities for one concrete type:

<!-- An HTML table, not a Markdown one: the cells contain `|`, and
     the site's Markdown renderer does not honor `\|` inside cells. -->
<table>
<thead>
<tr><th>Interface</th><th>For <code>Parser</code>, it means…</th><th>It bought us…</th></tr>
</thead>
<tbody>
<tr><td>Functor</td><td>transform the result</td><td><code>map toUpper (char 'a')</code></td></tr>
<tr><td>Applicative</td><td>run in sequence, threading leftover input</td><td><code>[| ... |]</code>, <code>*&gt;</code>, <code>&lt;*</code></td></tr>
<tr><td>Monad</td><td>let a result decide what to parse next</td><td><code>do</code>-notation, <code>natural</code></td></tr>
<tr><td>Alternative</td><td>try one, fall back to the other (full backtrack)</td><td><code>&lt;|&gt;</code>, <code>many</code>, <code>some</code></td></tr>
</tbody>
</table>

None of these are parser features. They are the *same* interfaces that `List`, `Maybe` and `IO` implement, which is why `map`, `do` and idiom brackets worked on parsers the moment we wrote the instances. Learn the interface once, and every type that implements it comes pre-equipped with vocabulary you already speak. A dedicated chapter, [Interfaces and Two Monoids](./16-interfaces.md), digs into this mechanism properly, but you have now *used* it, which is the part tutorials usually skip.

## Summary

- A `Parser a` is a record around one function: `List Char -> Maybe (a, List Char)` (result plus leftover input, or failure).
- `parse` demands full consumption: `Just (a, [])` or `Nothing`.
- `satisfy` and `char` are the only hand-written parsers; everything else is combination.
- Functor maps results; Applicative sequences while threading leftovers (idiom brackets `[| ... |]` are its sugar); Monad lets one result choose the next parser (`do`); Alternative gives `<|>` with full backtracking from the original input.
- `many`/`some` are mutually recursive and honestly `covering`: a non-consuming parser could loop, and Idris made us say so.
- `natural` = `some` digits + a left fold, because place value reads left to right.

We now have a bag of parser pieces; next we assemble them into a full grammar for regex notation itself, in [Parsing Pattern Syntax](./14-pattern-syntax.md).
