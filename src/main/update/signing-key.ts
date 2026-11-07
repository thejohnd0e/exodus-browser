/**
 * Public half of the release signing key (Ed25519). The updater accepts a release only when
 * `SHA256SUMS.sig` verifies against this key (DECISIONS #70). The private half lives outside the
 * repository; see `scripts/release-signing.mjs`. Replacing this key means every installed copy
 * must first be updated by an installer the user trusts, so rotate it deliberately.
 */
export const UPDATE_PUBLIC_KEY_PEM=`-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEANLFL+3quJDkYchl5OtY8AikxEjTnIGUDG4hBo1V+Xzs=
-----END PUBLIC KEY-----
`;
