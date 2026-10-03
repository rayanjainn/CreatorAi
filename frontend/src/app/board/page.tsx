import { redirect } from 'next/navigation'

/** `/board` is the documented name of the content board; the teammate's route is `/calendar`. */
export default function BoardRedirect() {
  redirect('/calendar')
}
