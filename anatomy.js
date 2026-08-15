// The two anatomy facts the generators need as badly as the page does, in one
// place so they cannot disagree about them.
//
// Both were hand-ported into gen-art.mjs with a comment saying it "has no way to
// import from a page", which was true of a module and never true of this: the
// page loads plain scripts with <script src> (sets.js has always come in that
// way) and node reads the same file with new Function(). Two copies and two
// check.mjs assertions policing them, to avoid one <script> tag.
//
// What goes in here is only what BOTH sides use. The shapes they hold cards in
// are different — the page has materialised objects, a generator has the raw
// tuples out of cards.json.gz — so each side maps into the shape below and the
// RULE is what is shared, rather than pushing one side's storage on the other.

/* Layouts with a genuine second side: a back face that has to be fetched
   separately, because Scryfall keys it off the same id with /back/ for /front/.
   gen-art.mjs decides whether to fetch a second image from this; the page
   decides whether to draw a flip control. Out of step, the page asks for files
   the downloader never wrote. */
const SIDED = new Set(['transform', 'modal_dfc', 'double_faced_token', 'art_series', 'reversible_card']);

/* `Card` is Scryfall's literal placeholder for a missing type line, not a type.
   It is what the source puts there when there is nothing to put. */
const bareType = t => !t || t === 'Card';

/* A frame's job is to hold a mana cost, a type line and a rules box. Some
   printings have none of the three — an art card, a Jumpstart theme divider
   whose whole text is "(Theme color: {G})", a punchcard, a "Poison Counter" —
   and a frame drawn over one of those is a name above two-thirds of empty box.
   3,249 of 107,347 printings fail this; every one is a picture with a name on it.

   `faces` is [{cost, type}] and cost may be a string or a token array: both
   answer .length, which is the only thing asked of it. Testing the FACE rather
   than a list of layouts is the point — `front_card` appeared in the catalogue
   after this rule was written and was covered without an edit. */
const framableFaces = faces => faces.some(f => f.cost?.length || !bareType(f.type));
