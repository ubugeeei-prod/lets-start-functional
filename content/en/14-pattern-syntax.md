---
title: Parsing Pattern Syntax
description: One parser per precedence level turns real regex notation like (colou?r|gr[ae]y) into the trees the engine already understands.
---

# Parsing Pattern Syntax

The combinators are on the workbench; time to build the thing we bought them for. By the end of this chapter, `(colou?r|gr[ae]y)` is a string a user can hand us, and a tree our engine can run.

## The grammar

Regex notation has precedence, just like arithmetic. In `ab|c`, the juxtaposition binds tighter than the bar: it means `(ab)|c`, not `a(b|c)`. In `ab*`, the star binds tighter still: `a(b*)`. Written as a grammar, loosest binding first (this is the module doc comment of `regex/src/Regex/Syntax.idr`):

```
alternation := sequence ('|' sequence)*
sequence    := repetition*
repetition  := atom ('*' | '+' | '?' | '{' count '}')*
atom        := '(' alternation ')' | '[' class ']'
             | '.' | '\' escape | plain character
```

The mapping rule that turns this grammar into code is beautifully mechanical: **one parser per precedence level**, each level's parser built out of calls to the next-tighter level. `alternation` calls `sequenceOf`, which calls `repetition`, which calls `atom`. And `atom`, at the bottom, loops back up to `alternation` for parenthesized groups. That loop is what makes the grammar recursive, and it will teach us something real about lazy versus strict evaluation before the chapter is out.

## Red: specs in three flavors

`regex/tests/src/Spec/Syntax.idr` opens with two helpers, because "compile this pattern and match that input" is about to be said twenty times:

```idris
||| Does the pattern compile and match the input?
ok : String -> String -> Bool
ok pat input =
  case compile pat of
    Just r  => matches r input
    Nothing => False

||| Does the pattern compile and reject the input?
no : String -> String -> Bool
no pat input =
  case compile pat of
    Just r  => not (matches r input)
    Nothing => False
```

Note that `no` is not `not . ok`: a pattern that *fails to compile* should count as neither. The first flavor of spec checks **structure**. The parser must produce exactly the trees we expect, precedence included:

```idris
export
syntaxSpecs : List Spec
syntaxSpecs =
  [ -- structure: the parser produces exactly the trees we expect
    shouldBe "the empty pattern is Eps"
      (compile "") (Just Eps)
  , shouldBe "a single character is a literal"
      (compile "a") (Just (lit 'a'))
  , shouldBe "juxtaposition is concatenation"
      (compile "ab") (Just (Cat (lit 'a') (lit 'b')))
  , shouldBe "the bar is alternation"
      (compile "a|b") (Just (Alt (lit 'a') (lit 'b')))
  , shouldBe "concatenation binds tighter than the bar"
      (compile "ab|c") (Just (Alt (Cat (lit 'a') (lit 'b')) (lit 'c')))
  , shouldBe "postfix operators bind tightest of all"
      (compile "ab*") (Just (Cat (lit 'a') (Star (lit 'b'))))
  , shouldBe "parentheses regroup"
      (compile "a(b|c)") (Just (Cat (lit 'a') (Alt (lit 'b') (lit 'c'))))
  , shouldBe "the wildcard is the any-character set"
      (compile ".") (Just (Sym anyChar))
```

The fifth and sixth specs *are* the precedence table, executable. If we ever wire the levels up in the wrong order, these two go red.

The second flavor checks that **malformed input is rejected**: trailing garbage is a failure, not a warning:

```idris
    -- malformed patterns are rejected, not guessed at
  , shouldBe "an unbalanced group does not compile"
      (compile "a)") Nothing
  , shouldBe "an unterminated class does not compile"
      (compile "[abc") Nothing
  , shouldBe "an unterminated count does not compile"
      (compile "a{2") Nothing
```

And the third flavor is **behavior**: the classics, plus everything the last three chapters built, now reachable by typing it:

```idris
    -- behavior: the classics
  , it "colou?r matches both spellings"
      (ok "colou?r" "color" && ok "colou?r" "colour")
  , it "gr[ae]y matches both spellings, nothing else"
      (ok "gr[ae]y" "gray" && ok "gr[ae]y" "grey" && no "gr[ae]y" "groy")
  , it "classes can be negated: [^0-9]+"
      (ok "[^0-9]+" "hello" && no "[^0-9]+" "hell0")
  , it "escaped metacharacters are plain characters"
      (ok "\\(\\)" "()" && ok "3\\.14" "3.14" && no "3\\.14" "3014")
  , it "\\d, \\w and \\s shorthands work"
      (ok "\\d+" "2026" && ok "\\w+" "snake_case" && ok "a\\sb" "a b")
  , it "negated shorthands too: \\D rejects digits"
      (ok "\\D+" "abc" && no "\\D+" "ab1")
  , it "counted repetition: a{3} and a{2,4} and a{2,}"
      (ok "a{3}" "aaa" && no "a{3}" "aa"
        && ok "a{2,4}" "aaaa" && no "a{2,4}" "aaaaa"
        && ok "a{2,}" "aaaaaa" && no "a{2,}" "a")
  , it "a real-world shape: \\w+@\\w+\\.\\w+"
      (ok "\\w+@\\w+\\.\\w+" "user@example.com"
        && no "\\w+@\\w+\\.\\w+" "not an email")
  , it "a date pattern, this time written as a pattern"
      (ok "\\d{4}-\\d{2}-\\d{2}" "2026-07-14"
        && no "\\d{4}-\\d{2}-\\d{2}" "2026-7-14")
  ]
```

(Three more behavior specs of the same shape, covering ranges `[a-c]+`, the wildcard's exactly-one-character rule, and `(ha)+` repeating as a unit, are in the commit; twenty-three specs in all.) The date pattern from the [sugar chapter](./12-sugar.md), which took a `where` block of nested function calls, is now seventeen characters.

```sh
make test
```

```
Error: Module Regex.Syntax not found

Spec.Syntax:11:1--11:20
 ...
 11 | import Regex.Syntax
      ^^^^^^^^^^^^^^^^^^^
```

Twenty-three specs red at once, more than any red step so far. This is commit [302ad49](https://github.com/ubugeeei-prod/lets-start-functional/commit/302ad496f1e0f0ca423c9f9853ad38ac7e058756).

## Green: the pattern parser

`Regex/Syntax.idr` imports everything we have, makes one admission up front, and names the characters that cannot stand for themselves:

```idris
-- A recursive grammar needs recursive parsers, and those (like
-- many/some) are honest `covering` functions rather than `total`.
%default covering

||| Characters that mean something special outside a class.
isMeta : Char -> Bool
isMeta c = elem c (unpack "()[]{}|*+?.\\")
```

### Escapes

A backslash escape shows up in two roles. Inside a class, `\n` should give us a *character*; at the top level, `\d` should give us a whole *regex atom*. Both start the same way: a backslash, then *whatever character comes next*. The bag of combinators from the [previous chapter](./13-parser-combinators.md) has no parser for "whatever character", so this commit adds one to `Regex/Parse.idr`:

```idris
||| Consume any single character.
public export
anyToken : Parser Char
anyToken = MkParser $ \cs =>
  case cs of
    (c :: rest) => Just (c, rest)
    []          => Nothing
```

It is the simplest parser there is: take the first character, whatever it is, and hand back the rest. The only way it can fail is when there is no character left to take. If the body looks familiar, that is because it is `satisfy` with the test deleted; `satisfy (const True)` would behave exactly the same. We spell it out anyway because "any character" deserves a name of its own, and with that name `char '\\' *> map interp anyToken` reads as what it does: a backslash, then any character, interpreted.

That one failure case matters. A pattern ending in a lone backslash (`a\`, or `"a\\"` as an Idris string) leaves `anyToken` nothing to take, so the escape fails, and since `\` is a metacharacter no other atom will accept it either: `compile "a\\"` is `Nothing`. A dangling escape is rejected, not guessed at.

With `anyToken` in hand, the two escape parsers are each a backslash followed by one character and a small table saying what that character means:

```idris
||| A backslash escape interpreted as a single character:
||| `\n`, `\t`, `\r`, or any escaped literal like `\.` or `\\`.
escapedChar : Parser Char
escapedChar = char '\\' *> map interp anyToken
  where
    interp : Char -> Char
    interp 'n' = '\n'
    interp 't' = '\t'
    interp 'r' = '\r'
    interp c   = c

||| A backslash escape interpreted as a regex atom. The shorthand
||| classes expand to the sets from `Regex.Set`; anything else is
||| the escaped character itself.
escapedAtom : Parser Regex
escapedAtom = char '\\' *> map interp anyToken
  where
    interp : Char -> Regex
    interp 'd' = Sym digit
    interp 'D' = Sym (complement digit)
    interp 'w' = Sym word
    interp 'W' = Sym (complement word)
    interp 's' = Sym space
    interp 'S' = Sym (complement space)
    interp 'n' = lit '\n'
    interp 't' = lit '\t'
    interp 'r' = lit '\r'
    interp c   = lit c
```

Notice who decides what counts as an escape. Not `anyToken`, which takes anything, but `interp`, whose last clause lets every other character stand for itself. That fallthrough is what turns `\.`, `\(` and `\\` into plain characters.

Savor the `'D'` line. In [Character Classes](./11-character-classes.md) we made `complement` a single field flip, and here is the dividend: the negated shorthand `\D`, a feature in its own right in most regex engines, costs us exactly one call to `complement`. Good representations keep paying after you have forgotten choosing them.

### Classes

Class syntax (`[a-c]`, `[^0-9]`, `[\d_-]`) is its own miniature language, so it gets its own parsers. Every class *item* contributes a list of ranges, and the whole class concatenates them:

```idris
||| Inside a class, `\d` `\w` `\s` contribute their ranges.
shorthandRanges : Parser (List (Char, Char))
shorthandRanges =
  char '\\' *>
    (   (char 'd' *> pure (ranges digit))
    <|> (char 'w' *> pure (ranges word))
    <|> (char 's' *> pure (ranges space)))

||| A literal character inside a class: anything but `]`, `\` or
||| `-` — those need escaping.
classChar : Parser Char
classChar = escapedChar <|> satisfy (\c => not (elem c (unpack "]\\-")))

||| One item of a class: a shorthand, a range `a-z`, or a single
||| character. Every item contributes a list of ranges.
classItem : Parser (List (Char, Char))
classItem = shorthandRanges <|> rangeOrSingle
  where
    rangeOrSingle : Parser (List (Char, Char))
    rangeOrSingle = do
      lo <- classChar
      (do _  <- char '-'
          hi <- classChar
          pure [(lo, hi)])
        <|> pure [(lo, lo)]

||| A whole class: `[...]` or negated `[^...]`.
classAtom : Parser Regex
classAtom = do
  _     <- char '['
  neg   <- (char '^' *> pure True) <|> pure False
  items <- some classItem
  _     <- char ']'
  pure (Sym (MkSet neg (concat items)))
```

`rangeOrSingle` is Monad and Alternative working together: parse a character, then *try* to continue with `-hi`; if that fails, the character stood alone. (In `shorthandRanges`, `ranges digit` is just record-field access used as a function: the list of ranges inside `digit`.) And `classAtom` reads like its own grammar rule (bracket, optional caret, items, bracket) before assembling a `MkSet` directly. The parser and the representation from two chapters ago click together with no adapter in between.

### Postfix operators are functions

Here is the chapter's slickest idea. What *is* `*` in `ab*`? It is something that takes the regex to its left and transforms it. So parse it as exactly that, a function:

```idris
||| A counted repetition suffix: `{n}`, `{n,}` or `{n,m}`.
counted : Parser (Regex -> Regex)
counted = do
  _ <- char '{'
  n <- natural
  f <- (do _ <- char ','
           (do m <- natural
               pure (between n m))
             <|> pure (atLeast n))
       <|> pure (exactly n)
  _ <- char '}'
  pure f

||| A postfix operator, as a *function on regexes*. `a**?` is legal
||| and pointless, exactly like in the AST.
postfix : Parser (Regex -> Regex)
postfix =
      (char '*' *> pure star)
  <|> (char '+' *> pure plus)
  <|> (char '?' *> pure opt)
  <|> counted
```

`postfix` has type `Parser (Regex -> Regex)`: a parser whose *result is a function*. In a language where functions are values, that is not exotic; it is Tuesday. `char '*' *> pure star` says: see a star character, produce the `star` smart constructor itself. The three-way branch inside `counted` mirrors the three syntaxes: `{n,m}` gives `between n m`, `{n,}` gives `atLeast n`, bare `{n}` gives `exactly n`, each a partially applied function from the sugar chapter, waiting for its regex.

### The grammar itself

Four rules, one `mutual` block, each rule calling the next-tighter one:

```idris
mutual
  ||| Lowest precedence: sequences separated by `|`.
  alternation : Parser Regex
  alternation = do
    first <- sequenceOf
    rest  <- many (char '|' *> sequenceOf)
    pure (foldl alt first rest)

  ||| Middle precedence: juxtaposition. Zero atoms is `Eps`,
  ||| which is why the empty pattern compiles.
  sequenceOf : Parser Regex
  sequenceOf = map (foldr cat Eps) (many repetition)

  ||| Highest precedence: an atom with its postfix operators,
  ||| applied left to right.
  repetition : Parser Regex
  repetition = do
    a     <- atom
    posts <- many postfix
    pure (foldl (\r, f => f r) a posts)

  ||| The atoms. `recur` delays the self-reference in `group` —
  ||| see `Regex.Parse.recur` for why.
  atom : Parser Regex
  atom = group <|> classAtom <|> wildcard <|> escapedAtom <|> plain
    where
      wildcard : Parser Regex
      wildcard = char '.' *> pure (Sym anyChar)

      plain : Parser Regex
      plain = map lit (satisfy (not . isMeta))

  group : Parser Regex
  group = char '(' *> recur alternation <* char ')'
```

Every fold here is earning its keep. `sequenceOf` folds `cat` over the atoms, the same `foldr cat Eps` shape as `literal` in the sugar chapter. `repetition` folds *function application* itself: `posts` is a list of `Regex -> Regex` functions, and `foldl (\r, f => f r) a posts` pipes the atom through each in left-to-right order, so `a*?` is `opt (star a)`, just as the notation reads. And `alternation` folds `alt` across the `|`-separated branches with a `foldl`, a line that is correct today and worth remembering: when we build a pretty-printer in [Printing Patterns Back](./17-pretty-printing.md), this exact fold will come under scrutiny and change direction. Folds have a handedness, and it shows up in the shape of your trees.

### The knot, and why Idris made us tie it

One line above deserves its own section: `group = char '(' *> recur alternation <* char ')'`. What is `recur`? It is the other thing this commit added to `Regex/Parse.idr`, next to `anyToken`:

```idris
||| Tie the knot for recursive grammars.
|||
||| In a lazy language a grammar can refer to itself and nothing
||| special happens. Idris evaluates eagerly, so a self-referential
||| parser value would try to build itself forever. `recur` accepts
||| the parser *lazily* and only looks inside once input arrives.
public export
recur : Lazy (Parser a) -> Parser a
recur p = MkParser $ \cs => runParser p cs
```

Our grammar is circular: `alternation` needs `atom`, and `atom` (through `group`) needs `alternation`. In Haskell, a lazy language, you write the circular definitions and nothing happens until input arrives; the knot ties itself silently. Idris evaluates eagerly: building `group` requires building `alternation` *right now*, which requires `group`, which requires `alternation`… an infinite regress at construction time, before a single character is parsed. `recur` breaks the loop by accepting its argument as `Lazy (Parser a)`, Idris's explicit "do not evaluate this yet" type, and only touching it inside the lambda, which runs when input shows up. The fix is two lines. The lesson is bigger: laziness is not free magic; it is a semantic choice that Haskell makes globally and silently, and Idris makes locally and *visibly*. Having to write `recur` once, in the one place the grammar bites its own tail, is a fair price for seeing exactly where recursion-in-data actually lives.

Finally, the front door. `Maybe` for now, upgraded in the next chapter:

```idris
||| Compile a pattern string into a regex — or `Nothing` when the
||| pattern is malformed. The parser must consume every character;
||| trailing garbage is a failure, not a warning.
public export
compile : String -> Maybe Regex
compile = parse alternation
```

Those malformed-input specs (`"a)"`, `"[abc"`, `"a{2"`) pass with no rejection code anywhere. `parse` already demands full consumption, so a parser that stops at the stray `)` has failed by definition. We wrote that policy one chapter ago; it just paid out three specs for free.

```sh
make test
```

```
  ...
  ok    the empty pattern is Eps
  ...
  ok    a real-world shape: \w+@\w+\.\w+
  ok    a date pattern, this time written as a pattern
121/121 passed
```

All twenty-three specs, one green commit: [a7eef7c](https://github.com/ubugeeei-prod/lets-start-functional/commit/a7eef7cbef3dcb1c6a53c1dad355a7bcc1341b33). It is worth pausing on that. A hundred and fifty lines of genuinely intricate code (recursive grammar, escapes, classes, counted repetition) landed in a single red-to-green step. That is not bravado; it is the dividend of the [previous chapter](./13-parser-combinators.md). Every combinator underneath was already specified and tested in isolation, so assembling them was the only step left to get wrong, and the twenty-three specs were standing by to catch even that.

## Summary

- Regex notation is a grammar with precedence; the translation is mechanical: one parser per precedence level, each built from the next-tighter one.
- Specs came in three flavors: structure (the precedence table, executable), malformed input (trailing garbage is failure, enforced by `parse` with no extra code), and behavior (the classics: `colou?r`, `gr[ae]y`, an email shape, the date).
- Postfix operators parse as *functions* `Regex -> Regex`, applied to their atom by a `foldl`: `star`, `plus`, `opt`, `between n m` are the parse results themselves.
- `\D` is one `complement` call; class items each contribute ranges that assemble straight into `MkSet`.
- The grammar's self-reference needs `recur : Lazy (Parser a) -> Parser a`: eager Idris makes visible the knot that lazy Haskell ties silently. And `alternation`'s `foldl alt` is a line with a future ([Printing Patterns Back](./17-pretty-printing.md)).

`compile` still answers failure with a bare `Nothing`: no position, no message. Turning that into an API worth shipping is [A Public API](./15-public-api.md).
