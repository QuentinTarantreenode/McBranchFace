//! Scanning every repository: the pipeline without Tauri, shared by the app and the headless scan.

pub mod cancel;
pub mod pipeline;
mod sign_in;

pub use cancel::Cancel;
pub use pipeline::{assesses_online, primary_copy, run_scan, ScanDeps, ScanRequest, ScanSink};
