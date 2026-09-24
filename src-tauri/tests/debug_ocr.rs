use windows::core::HSTRING;
use windows::Globalization::Language;
use windows::Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap};
use windows::Media::Ocr::OcrEngine;
use windows::Storage::Streams::DataWriter;

#[test]
fn test_windows_ocr_engine_creation() {
    let lang = Language::CreateLanguage(&HSTRING::from("zh-Hans-CN")).expect("CreateLanguage failed");
    let engine = OcrEngine::TryCreateFromLanguage(&lang).expect("TryCreateFromLanguage failed");
    assert!(engine.RecognizerLanguage().is_ok());

    let width = 64i32;
    let height = 32i32;
    let bgra = vec![255u8; (width * height * 4) as usize];

    let writer = DataWriter::new().expect("DataWriter::new failed");
    writer.WriteBytes(&bgra).expect("WriteBytes failed");
    let buffer = writer.DetachBuffer().expect("DetachBuffer failed");

    let software_bitmap = SoftwareBitmap::CreateCopyFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        width,
        height,
    ).expect("SoftwareBitmap::CreateCopyFromBuffer failed");

    let op = engine.RecognizeAsync(&software_bitmap).expect("RecognizeAsync failed");
    let result = op.get().expect("RecognizeAsync get failed");
    assert_eq!(result.Text().unwrap_or_default().to_string(), "");
}
