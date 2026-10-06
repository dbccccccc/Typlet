//! A minimal Typst world: one in-memory source, Typst's bundled fonts, no file
//! or package access, and no clock. Outputs are therefore deterministic.

use std::sync::LazyLock;

use typst::diag::{FileError, FileResult};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, Source};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Feature, Library, LibraryExt, World};

/// The standard library for paged output.
static PAGED: LazyLock<LazyHash<Library>> = LazyLock::new(|| LazyHash::new(Library::default()));

/// The standard library with HTML export enabled, for MathML output.
static HTML: LazyLock<LazyHash<Library>> = LazyLock::new(|| {
    LazyHash::new(Library::builder().with_features([Feature::Html].into_iter().collect()).build())
});

/// Typst's bundled fonts: Libertinus Serif, New Computer Modern (text and
/// math) and DejaVu Sans Mono. These are the fonts the Typst CLI uses with
/// `--ignore-system-fonts`.
static FONTS: LazyLock<(LazyHash<FontBook>, Vec<Font>)> = LazyLock::new(|| {
    let fonts: Vec<Font> = typst_assets::fonts()
        .flat_map(|data| Font::iter(Bytes::new(data)))
        .collect();
    (LazyHash::new(FontBook::from_fonts(&fonts)), fonts)
});

/// Which standard library a document is compiled with.
#[derive(Clone, Copy)]
pub enum Target {
    Paged,
    Html,
}

pub struct OracleWorld {
    library: &'static LazyHash<Library>,
    main: Source,
}

impl OracleWorld {
    pub fn new(text: String, target: Target) -> Self {
        let library = match target {
            Target::Paged => &*PAGED,
            Target::Html => &*HTML,
        };
        Self { library, main: Source::detached(text) }
    }
}

impl World for OracleWorld {
    fn library(&self) -> &LazyHash<Library> {
        self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        &FONTS.0
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::AccessDenied)
        }
    }

    fn file(&self, _: FileId) -> FileResult<Bytes> {
        Err(FileError::AccessDenied)
    }

    fn font(&self, index: usize) -> Option<Font> {
        FONTS.1.get(index).cloned()
    }

    fn today(&self, _: Option<Duration>) -> Option<Datetime> {
        None
    }
}

/// The standard library for paged output, for commands that inspect it.
pub fn paged_library() -> &'static Library {
    &PAGED
}
