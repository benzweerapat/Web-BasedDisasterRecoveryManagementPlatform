import React from 'react';

export default function Button({variant,size='md',icon:Icon,loading=false,disabled=false,type='button',className='',children,...props}) {
  // Only base utilities describe intent; hover colors must not change the variant.
  const tokens = className.split(/\s+/);
  variant=variant||(tokens.some(token => /^(?:text|bg)-(?:red|rose)-/.test(token))?'danger':tokens.includes('text-white')?'primary':'secondary');
  return <button {...props} type={type} disabled={disabled||loading} aria-busy={loading||undefined} data-button-variant={variant} className={`app-button app-button-${variant} app-button-${size} ${className}`}>
    {loading?'Loading...':<>{Icon?<Icon size={16}/>:null}{children}</>}
  </button>;
}