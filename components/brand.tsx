/** Shared brand lockup; the adjacent name is the accessible label. */
export function Brand({href = '/', name = 'Puduvai Voice', place = 'Puducherry'}: {href?: string; name?: string; place?: string}) {
 return <a className="brand" href={href}><img className="brand-mark" src="/brand/puduvai-voice-mark.svg" width={48} height={48} alt="" aria-hidden="true"/><span>{name}<small>{place}</small></span></a>;
}
