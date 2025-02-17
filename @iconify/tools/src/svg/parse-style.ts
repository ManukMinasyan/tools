import type { SVG } from '.';
import { parseInlineStyle } from '../css/parse';
import { tokensToString } from '../css/parser/export';
import { getTokens } from '../css/parser/tokens';
import { tokensTree } from '../css/parser/tree';
import type { CSSRuleToken, CSSToken } from '../css/parser/types';
import { parseSVG, ParseSVGCallbackItem } from './parse';

/**
 * Item in callback
 */
interface ParseSVGStyleCallbackItemCommon {
	prop: string;
	value: string;
}
interface ParseSVGStyleCallbackItemInline
	extends ParseSVGStyleCallbackItemCommon {
	type: 'inline';
	item: ParseSVGCallbackItem;
}
interface ParseSVGStyleCallbackItemGlobal
	extends ParseSVGStyleCallbackItemCommon {
	type: 'global';
	token: CSSRuleToken;
	selectors: string[];
	selectorTokens: CSSToken[];
	prevTokens: (CSSToken | null)[];
	nextTokens: CSSToken[];
}

export type ParseSVGStyleCallbackItem =
	| ParseSVGStyleCallbackItemInline
	| ParseSVGStyleCallbackItemGlobal;

/**
 * Result: undefined to remove item, string to change/keep item
 */
export type ParseSVGStyleCallbackResult = string | undefined;

/**
 * Callback function
 */
export type ParseSVGStyleCallback = (
	item: ParseSVGStyleCallbackItem
) => ParseSVGStyleCallbackResult | Promise<ParseSVGStyleCallbackResult>;

/**
 * Parse styles in SVG
 *
 * This function finds CSS in SVG, parses it, calls callback for each rule.
 * Callback should return new value (string) or undefined to remove rule.
 * Callback can be asynchronous.
 */
export async function parseSVGStyle(
	svg: SVG,
	callback: ParseSVGStyleCallback
): Promise<void> {
	return parseSVG(svg, async (item) => {
		const tagName = item.tagName;
		const $element = item.$element;

		if (tagName === 'style') {
			// Style tag
			const content = $element.text();
			if (typeof content !== 'string') {
				$element.remove();
				return;
			}

			const tokens = getTokens(content);
			if (!(tokens instanceof Array)) {
				// Invalid style
				throw new Error('Error parsing style');
			}

			// Parse all tokens
			let changed = false;
			const selectorStart: number[] = [];
			const newTokens: (CSSToken | null)[] = [];
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i];
				switch (token.type) {
					case 'selector':
					case 'at-rule':
						selectorStart.push(newTokens.length);
						break;

					case 'close':
						selectorStart.pop();
						break;
				}

				if (token.type !== 'rule') {
					newTokens.push(token);
					continue;
				}

				const value = token.value;

				const selectorTokens = selectorStart
					.map((index) => newTokens[index])
					.filter((item) => item !== null) as CSSToken[];

				let result = callback({
					type: 'global',
					prop: token.prop,
					value,
					token,
					selectorTokens,
					selectors: selectorTokens.reduce(
						(prev: string[], current: CSSToken) => {
							switch (current.type) {
								case 'selector': {
									return prev.concat(current.selectors);
								}
							}
							return prev;
						},
						[] as string[]
					),
					prevTokens: newTokens,
					nextTokens: tokens.slice(i + 1),
				});
				if (result instanceof Promise) {
					result = await result;
				}

				if (result !== void 0) {
					if (result !== value) {
						changed = true;
						token.value = result;
					}
					newTokens.push(token);
				} else {
					// Delete token
					changed = true;
				}
			}

			if (!changed) {
				return;
			}

			// Update style
			const tree = tokensTree(
				newTokens.filter((token) => token !== null) as CSSToken[]
			);
			if (!tree.length) {
				// Empty
				$element.remove();
				return;
			}

			const newContent = tokensToString(tree);
			item.$element.text(newContent);
			return;
		}

		// Parse style
		const attribs = item.element.attribs;
		if (attribs.style === void 0) {
			return;
		}

		const parsedStyle = parseInlineStyle(attribs.style);
		if (parsedStyle === null) {
			// Ignore style
			$element.removeAttr('style');
			return;
		}

		const props = Object.keys(parsedStyle);
		let changed = false;
		for (let i = 0; i < props.length; i++) {
			const prop = props[i];
			const value = parsedStyle[prop];
			let result = callback({
				type: 'inline',
				prop,
				value,
				item,
			});
			if (result instanceof Promise) {
				result = await result;
			}

			if (result !== value) {
				changed = true;
				if (result === void 0) {
					delete parsedStyle[prop];
				} else {
					parsedStyle[prop] = result;
				}
			}
		}

		// Update style
		if (!changed) {
			return;
		}
		const newStyle = Object.keys(parsedStyle)
			.map((key) => key + ':' + parsedStyle[key] + ';')
			.join('');
		if (!newStyle.length) {
			$element.removeAttr('style');
		} else {
			$element.attr('style', newStyle);
		}
	});
}
