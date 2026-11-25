// SPDX-FileCopyrightText: 2026 Hearth contributors
// SPDX-License-Identifier: AGPL-3.0-only
//
// The plugin's sources import each other without ".js" (the bundler adds
// it); this resolve hook does the same for node, so the tests run the
// sources as they are.
export async function resolve(specifier, context, next) {
  if (/^\.\.?\//.test(specifier) && !/\.[cm]?js$/.test(specifier)) {
    try {
      return await next(specifier + '.js', context)
    } catch (e) {
      // not a file of ours: resolved as given below
    }
  }
  return next(specifier, context)
}
