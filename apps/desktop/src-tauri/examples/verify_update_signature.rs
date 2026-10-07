//! Release gate; never reads a private signing key or installs an executable.
use base64::{engine::general_purpose::STANDARD, Engine};
use std::error::Error;

fn main() -> Result<(), Box<dyn Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        return Err("expected installer, signature file and version".into());
    }
    let public =
        String::from_utf8(STANDARD.decode(std::env::var("PR0_UPDATE_PUBLIC_KEY")?.trim())?)?;
    let signature = String::from_utf8(STANDARD.decode(std::fs::read_to_string(&args[2])?.trim())?)?;
    let public = minisign::PublicKey::from_box(minisign::PublicKeyBox::from_string(&public)?)?;
    let signature = minisign::SignatureBox::from_string(&signature)?;
    minisign::verify(
        &public,
        &signature,
        std::fs::File::open(&args[1])?,
        true,
        false,
        false,
    )?;
    if !signature
        .trusted_comment()?
        .split('\t')
        .any(|field| field == format!("version:{}", args[3]))
    {
        return Err("signature does not bind the expected release version".into());
    }
    println!("Updater signature and release version verified");
    Ok(())
}
