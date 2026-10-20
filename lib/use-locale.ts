'use client';
import {useCallback,useEffect,useState} from 'react';
import type {Locale} from './domain';
const valid=(value:string|null):value is Locale=>value==='en'||value==='ta'||value==='hi';
const choiceKey='puduvai-language-chosen';
export function useLocale(){
 const [locale,updateLocale]=useState<Locale>('en');
 const [showChooser,setShowChooser]=useState(false);
 const setLocale=useCallback((value:Locale)=>{
  updateLocale(value);setShowChooser(false);
  const url=new URL(window.location.href);url.searchParams.set('lang',value);window.history.replaceState(null,'',url);
  try{localStorage.setItem('locale',value);localStorage.setItem(choiceKey,'true')}catch{/* The choice still works for this visit when storage is unavailable. */}
 },[]);
 useEffect(()=>{
  const linked=new URLSearchParams(window.location.search).get('lang');
  if(valid(linked)){setLocale(linked);return}
  try{
   const saved=localStorage.getItem('locale');
   if(valid(saved)&&localStorage.getItem(choiceKey)==='true'){updateLocale(saved);return}
  }catch{/* Show the chooser when a preference cannot be read. */}
  setShowChooser(true);
 },[setLocale]);
 useEffect(()=>{document.documentElement.lang=locale},[locale]);
 return {locale,setLocale,showChooser};
}
