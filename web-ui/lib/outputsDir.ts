import fs from 'fs';

/**
 * The application's single intended runtime location for generated CAD
 * artifacts (STL/STEP/DXF/G-code/script backups). In Docker (production and
 * `docker-compose.dev.yml`), both `web-ui` and `ai-engine` mount the same
 * `cad_outputs` volume at this exact path — see docker-compose.yml.
 *
 * This is intentionally NOT resolved relative to `process.cwd()`: doing so
 * previously let local development (cwd = repo/web-ui) silently resolve to
 * the repository's own tracked `outputs/` directory one level up, which is
 * unrelated development/test fixture data, not real runtime output.
 */
export const OUTPUTS_DIR = '/app/outputs';

/**
 * Returns OUTPUTS_DIR if it actually exists on disk, or null otherwise.
 * Callers must treat null as "nothing to do" rather than falling back to
 * a guessed path.
 */
export function resolveOutputsDir(): string | null {
	try {
		return fs.existsSync(OUTPUTS_DIR) ? OUTPUTS_DIR : null;
	} catch {
		return null;
	}
}
