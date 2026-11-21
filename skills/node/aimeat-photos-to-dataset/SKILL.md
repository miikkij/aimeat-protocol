---
name: aimeat-photos-to-dataset
description: Turn photographs, scans and attached documents into a data package on an AIMEAT node, with every row linked back to the picture it was read from. The paved path for "here are photos of my receipts / meter readings / business cards / invoices, make something out of them". Covers the shape decision, the append trap that silently deletes yesterday's rows, and what to say to the person.
license: MIT
metadata:
  audience: agent
---

# Photographs into data

Somebody hands you pictures. Receipts, meter readings, a stack of business cards, invoices, pages of
a paper form, a whiteboard. What they want is not a description of the pictures: it is the table
underneath them, kept somewhere they can use it next month and the month after.

That table is a **data package** on their node: a Table Schema, canonical CSV bytes, provenance, and
a permanent address every other program reads directly. `aimeat_datapackage_publish` makes one.

## The one rule that separates this from a summary

**Every row keeps the address of the picture it came from.** Put the storage key of the photograph in
a `source_image` column, and the node turns it into that picture's permanent address on publish. For
a document that ran to several pages, `source_image_2`, `source_image_3`.

This is not bookkeeping. A total you read as 12.50 is either right or a misread 12,50, and the only
way anybody settles that, including the person a year from now, is by looking at the picture again.
A table made from photographs with no way back to them is a set of claims nobody can check.

**The picture stays exactly as private as it was.** The table is public at its address; the
photograph answers 403 to a stranger who follows the link and gives the bytes to its owner.
Publishing a spending summary must never publish thirty photographs of somebody's life. Do not
change a photograph's visibility to "fix" the link. It is not broken.

Two things the node refuses, before it writes anything: a picture that is not in their files (the
table would point at nothing) and a picture belonging to somebody else (a published table is read by
anyone). Both refusals name the file.

## Decide the shape, and say why if you go the other way

**Default: one package per subject, growing.** All receipts in `receipts-2026`, one row per receipt,
a new version every time a batch arrives. Data packages are versioned by content hash and the history
is already readable, so "show me all my receipts" is one address instead of thirty, and last
February is still there under its own version.

Think it through rather than applying it blindly. Go per batch, or per period, when there is a
reason, and **say the reason out loud** when you propose it. Real reasons:

- **The batches are genuinely different things.** Receipts and meter readings are two packages, not
  one wide table with half its columns empty.
- **It grows without end.** A daily meter photograph is 365 rows a year and fine; a machine
  photographed every minute is not. Per month or per quarter then, named `readings-2026-08`.
- **They have different audiences or different terms.** One batch to be sold or shared and another
  private is two packages, because a package is licensed and addressed as a whole.
- **It has stopped growing.** Last year's receipts are closed. Leave them closed and start a new one
  rather than reopening a package to add one straggler.

Not a reason: it was easier this time, or the previous package was published by somebody else.

## The trap that will bite you first

**A resource is the WHOLE table, not an append.** Publish today's three receipts on their own and
yesterday's forty are gone. No error, no warning, a new version with three rows.

To add to an existing package:

1. `aimeat_datapackage_export` with `format: "json"` (or `"url"` and fetch the CSV) to get what is
   already there.
2. Concatenate. Drop anything already present. The same picture read twice is the common case, and
   the `source_image` address is what makes it detectable.
3. `aimeat_datapackage_publish` with the whole table, and `changes` saying what this batch added.

`changes` is required and it is read by a person deciding whether to trust the version. "Added 3
receipts photographed on 17 August" is useful. "update" is not.

## Keep the columns still

The second batch has to land in the same table as the first. Before you invent a column name, look
at what the package already uses: `aimeat_datapackage_export` gives you the Table Schema, and the
schema names every column and its type so you never have to guess.

Within one subject, a column means the same thing in every row. If this batch has something the last
one did not, add a column and leave it empty for the older rows rather than renaming an existing one:
a renamed column silently splits one series into two.

Dates as `YYYY-MM-DD`. Money as a number, not a string with a currency symbol in it; the currency is
its own column when it varies. One fact per column.

## When a picture will not read

Say so, name it, and publish the rest. A batch of forty that lands as thirty-eight plus two named
failures is a good outcome; a batch that fails whole because two pictures were blurry is not.

Put the failures where the person can act on them: which picture, what was unreadable, and what
would fix it (a straighter photograph, better light, the other side of the card). If a value is
genuinely uncertain rather than unreadable, do not guess it into the table. Leave the cell empty and
say which row needs a look. A confident wrong number is worse than a gap, because nobody checks it.

## Say it in their words

They asked for something useful, not for a report on your work. Before you start, propose in three
or four lines what you are about to make, in words they can judge without knowing a single AIMEAT
term. Not "a data package with an inferred Table Schema and a source_image column"; rather:

> I'll read all 40 receipts into one table for 2026, with the shop, the date and the total, and each
> row keeps a link to its own photo so you can check any of them. The photos stay private. Shall I?

When it is done, hand back **one address** and what is in it. The content hash, the schema source
and the version number are yours, not theirs. The table is visible in VAULT, which is where they go
to look at what they now have.

If you had to choose a shape other than one growing package, that is the one technical thing worth
one plain sentence: "I kept the meter readings separate from the receipts, because they are
different measurements and mixing them would leave half the table empty."

## Where the pictures come from

All of these end up the same way, as a file in the person's own storage, and then this flow:

- **Their phone, into the node's own chat.** The picker offers the camera, and the OS share sheet
  sends straight into the chat from any app.
- **An AI chat you are running in.** Upload with `aimeat_storage_upload`, presigned for anything over
  about 1 kB, so the bytes never travel through your context.
- **A PDF, a Word document or a spreadsheet.** The node reads these as text on its own, so you get
  the contents rather than the bytes. A PDF with no text in it is a photograph of a page: say so and
  read it as a picture.

## Do / Don't

- **Do** put the picture's key in `source_image` on every row that came from one.
- **Do** read the existing rows before publishing an addition.
- **Do** default to one growing package per subject, and say why when you do otherwise.
- **Do** leave a cell empty when you are not sure, and name the row that needs a look.
- **Don't** change a photograph's visibility to make a link "work". It works.
- **Don't** rename a column between batches.
- **Don't** hand back a hash, a schema source or a version number as if it answered anything.
