"""Builds Typlet's web fonts from New Computer Modern Math (docs/DESIGN.md §4).

Reads a plan as JSON on stdin, written by tools/fonts/build.mjs:

    {"outDir": directory for the woff2 files,
     "family": the new family name,
     "faces": [{"source": path to a NewCMMath-*.otf font,
                "postScriptName": the new PostScript name,
                "style": "Book" or "Bold",
                "privateUse": [[code point, glyph id], ...],
                "layoutFeatures": OpenType features to keep,
                "keepMath": whether to keep the MATH table,
                "files": [{"name": file name, "unicodes": [...],
                           "glyphs": [glyph id, ...]}, ...]}, ...]}

For each file, it subsets its face's font to the given glyphs and code
points, mapping the private-use code points to glyphs that have no code
point of their own. It renames the font as the GUST Font License asks, sets
the hhea, typo and win vertical metrics to the same values, converts the
outlines to TrueType curves, and writes woff2. It prints one JSON line per
file: {"name", "bytes", "glyphs"}.

TrueType outlines compress a third better in woff2 than the font's CFF ones.
They follow the cubic curves within one font unit, far below what a screen
shows, and keep the glyph order that the MATH, GSUB and GPOS tables refer to.
Like Typst's own output, they are unhinted.

Requires fontTools with brotli: pip install -r tools/fonts/requirements.txt
"""

import json
import os
import sys

from fontTools import subset
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

# The largest distance between a cubic curve and its quadratic replacement,
# in font units.
MAX_ERROR = 1.0


def is_private_use(cp):
    return 0xE000 <= cp <= 0xF8FF or cp >= 0xF0000


def prepare(font, family, face):
    """Remaps private-use code points, renames the font and fixes its metrics."""
    order = font.getGlyphOrder()
    private_use = {cp: order[gid] for cp, gid in face["privateUse"]}
    for table in font["cmap"].tables:
        if table.format == 14 or not table.isUnicode():
            continue
        cmap = {cp: name for cp, name in table.cmap.items() if not is_private_use(cp)}
        cmap.update({cp: n for cp, n in private_use.items() if table.format != 4 or cp <= 0xFFFF})
        table.cmap = cmap

    ps_name, style = face["postScriptName"], face["style"]
    names = font["name"]
    copyright_notice = names.getDebugName(0)
    version = names.getDebugName(5)
    for record in list(names.names):
        if record.nameID not in (0, 5):
            names.removeNames(nameID=record.nameID)
    for name_id, value in (
        (1, family),
        (2, "Bold" if style == "Bold" else "Regular"),
        (3, f"{version};{ps_name}"),
        (4, f"{family} {style}"),
        (6, ps_name),
        (16, family),
        (17, style),
    ):
        names.setName(value, name_id, 3, 1, 0x409)
    if copyright_notice:
        names.setName(copyright_notice, 0, 3, 1, 0x409)
    cff = font["CFF "].cff
    cff.fontNames = [ps_name]
    top = cff.topDictIndex[0]
    top.FullName = f"{family} {style}"
    top.FamilyName = family

    # Every browser places the baseline from the same ascent and descent.
    hhea, os2 = font["hhea"], font["OS/2"]
    os2.sTypoAscender, os2.sTypoDescender, os2.sTypoLineGap = hhea.ascent, hhea.descent, hhea.lineGap
    os2.usWinAscent, os2.usWinDescent = hhea.ascent, -hhea.descent
    os2.fsSelection |= 1 << 7  # USE_TYPO_METRICS


def to_truetype(font):
    """Replaces the CFF outlines with quadratic TrueType ones."""
    order = font.getGlyphOrder()
    glyphs = font.getGlyphSet()
    glyf = newTable("glyf")
    glyf.glyphOrder = order
    glyf.glyphs = {}
    for name in order:
        pen = TTGlyphPen(glyphs)
        glyphs[name].draw(Cu2QuPen(pen, MAX_ERROR, reverse_direction=True))
        glyf.glyphs[name] = pen.glyph()
    del font["CFF "]
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    gasp = font["gasp"] = newTable("gasp")
    gasp.gaspRange = {0xFFFF: 0x000F}
    maxp = font["maxp"]
    maxp.tableVersion = 0x00010000
    for field in (
        "maxPoints", "maxContours", "maxCompositePoints", "maxCompositeContours", "maxTwilightPoints",
        "maxStorage", "maxFunctionDefs", "maxInstructionDefs", "maxStackElements",
        "maxSizeOfInstructions", "maxComponentElements", "maxComponentDepth",
    ):
        setattr(maxp, field, 0)
    maxp.maxZones = 1
    font["head"].glyphDataFormat = 0
    font["post"].formatType = 3.0
    font.sfntVersion = "\x00\x01\x00\x00"


def expected_cmap(face, order):
    """The glyph names code points should map to: the source font's own mapping
    for its characters, and the face's private-use ones."""
    source = TTFont(face["source"])
    cmap = {cp: name for cp, name in source.getBestCmap().items() if not is_private_use(cp)}
    cmap.update({cp: order[gid] for cp, gid in face["privateUse"]})
    return cmap


def build(plan, face, spec, expected):
    # Keep the source's timestamps, so that builds are reproducible.
    font = TTFont(face["source"], recalcTimestamp=False)
    prepare(font, plan["family"], face)
    order = font.getGlyphOrder()

    options = subset.Options()
    options.layout_features = face["layoutFeatures"]
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 16, 17]
    options.notdef_outline = True
    options.drop_tables += ["FFTM", "PfEd"] + ([] if face["keepMath"] else ["MATH"])
    # Inlining the subroutines makes the woff2 files smaller; the outlines
    # stay the same.
    options.desubroutinize = True
    options.flavor = "woff2"

    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=spec["unicodes"], glyphs=[order[gid] for gid in spec["glyphs"]])
    subsetter.subset(font)

    # Every glyph is kept, and every code point maps to the glyph it should.
    kept = set(font.getGlyphOrder())
    missing = [gid for gid in spec["glyphs"] if order[gid] not in kept]
    if missing:
        raise SystemExit(f"{spec['name']}: glyphs {missing[:10]} were dropped")
    cmap = font.getBestCmap()
    unicodes = set(spec["unicodes"])
    wrong = [hex(cp) for cp, name in expected.items() if cp in unicodes and cmap.get(cp) != name]
    if wrong:
        raise SystemExit(f"{spec['name']}: code points {wrong[:10]} map to the wrong glyphs")
    to_truetype(font)

    path = os.path.join(plan["outDir"], spec["name"])
    font.flavor = "woff2"
    font.save(path)
    return {"name": spec["name"], "bytes": os.path.getsize(path), "glyphs": len(font.getGlyphOrder())}


def main():
    plan = json.load(sys.stdin)
    os.makedirs(plan["outDir"], exist_ok=True)
    for face in plan["faces"]:
        order = TTFont(face["source"]).getGlyphOrder()
        expected = expected_cmap(face, order)
        for spec in face["files"]:
            print(json.dumps(build(plan, face, spec, expected)), flush=True)


if __name__ == "__main__":
    main()
